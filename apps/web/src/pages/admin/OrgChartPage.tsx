import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../app/AuthContext';
import { usePageChrome } from '../../app/page-chrome';
import { densityRowClass, usePreferences } from '../../app/preferences';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Input } from '../../components/ui/Input';
import { Skeleton } from '../../components/ui/Skeleton';
import { adminApi } from '../../lib/api-client';
import { ApiError, friendlyErrorMessage } from '../../lib/api-error';
import { qk } from '../../lib/query-keys';
import { AdminHeader, loadAllPages } from './shared';
import { OrgNode } from './OrgNode';
import { buildHierarchy, searchHierarchy, type OrgNode as OrgNodeData } from './org-hierarchy';

/** Roots and their direct reports start open; deeper branches start closed. */
const DEFAULT_EXPANDED_DEPTH = 2;

function collectDefaultExpanded(nodes: readonly OrgNodeData[], depth: number): string[] {
  if (depth >= DEFAULT_EXPANDED_DEPTH) return [];
  return nodes.flatMap((node) => [
    node.user.id,
    ...collectDefaultExpanded(node.children, depth + 1),
  ]);
}

export function OrgChartPage() {
  const { can } = useAuth();
  const { tableDensity } = usePreferences();
  const [query, setQuery] = useState('');
  const [manualExpanded, setManualExpanded] = useState<Set<string> | null>(null);

  usePageChrome('Org chart', [qk.directory()]);

  /**
   * The whole directory is needed before anything can render: a partial page
   * would show people as roots simply because their manager hadn't loaded yet.
   */
  const usersQuery = useQuery({
    queryKey: qk.directoryUsers(),
    queryFn: () => loadAllPages((page, pageSize) => adminApi.users({ page, pageSize })),
  });

  // Role names live behind a different permission than the user list, so this
  // degrades rather than failing the page.
  const rolesQuery = useQuery({
    queryKey: qk.directoryRoles(),
    queryFn: () => loadAllPages((page, pageSize) => adminApi.roles(page, undefined, pageSize)),
    enabled: can('roles_permissions', 'view'),
    staleTime: 300_000,
  });

  const departmentsQuery = useQuery({
    queryKey: qk.directoryDepartments(),
    queryFn: () =>
      loadAllPages((page, pageSize) => adminApi.departments(page, undefined, pageSize)),
    staleTime: 300_000,
  });

  const hierarchy = useMemo(() => buildHierarchy(usersQuery.data ?? []), [usersQuery.data]);

  const roleNames = useMemo(
    () => new Map((rolesQuery.data ?? []).map((role) => [role.id, role.name])),
    [rolesQuery.data],
  );
  const departmentNames = useMemo(
    () => new Map((departmentsQuery.data ?? []).map((dept) => [dept.id, dept.name])),
    [departmentsQuery.data],
  );

  const trimmed = query.trim().toLowerCase();
  const search = useMemo(() => {
    if (!trimmed) return null;
    return searchHierarchy(hierarchy.roots, (node) => {
      const role = roleNames.get(node.user.roleId) ?? '';
      const department = node.user.departmentId
        ? (departmentNames.get(node.user.departmentId) ?? '')
        : '';
      return [node.user.name, node.user.email, role, department]
        .join(' ')
        .toLowerCase()
        .includes(trimmed);
    });
  }, [trimmed, hierarchy.roots, roleNames, departmentNames]);

  const defaultExpanded = useMemo(
    () => new Set(collectDefaultExpanded(hierarchy.roots, 0)),
    [hierarchy.roots],
  );

  // A search auto-expands the path to each hit; clearing it restores whatever
  // the user had opened by hand.
  const expanded = search
    ? new Set([...(manualExpanded ?? defaultExpanded), ...search.ancestorIds])
    : (manualExpanded ?? defaultExpanded);

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setManualExpanded(next);
  };

  const forbidden = usersQuery.error instanceof ApiError && usersQuery.error.status === 403;

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <AdminHeader
        title="Org chart"
        description="Who reports to whom, built from each person's manager."
      />

      {hierarchy.warnings.map((warning, index) => (
        <Banner key={index} tone="info">
          {warning.kind === 'cycle'
            ? `A reporting loop was found between ${warning.names.join(', ')} — they're shown at the top level.`
            : `${warning.names.length} ${warning.names.length === 1 ? 'person reports' : 'people report'} to someone outside the users you can see: ${warning.names.join(', ')}.`}
        </Banner>
      ))}

      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label htmlFor="org-search" className="sr-only">
            Search people
          </label>
          <Input
            id="org-search"
            type="search"
            className="max-w-xs"
            placeholder="Search by name, email, role, or department"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {search ? (
            <>
              <span className="text-sm text-ink-soft">
                {search.matchIds.size}{' '}
                {search.matchIds.size === 1 ? 'person matches' : 'people match'}
              </span>
              <Button variant="secondary" size="sm" onClick={() => setQuery('')}>
                Clear
              </Button>
            </>
          ) : null}
        </div>

        {forbidden ? (
          <EmptyState
            title="You don't have permission to view the user directory"
            description="Ask an administrator for access to users if you need the reporting structure."
          />
        ) : usersQuery.isError ? (
          <Banner tone="error">{friendlyErrorMessage(usersQuery.error)}</Banner>
        ) : usersQuery.isPending ? (
          <div role="status" className="space-y-2">
            <span className="sr-only">Loading the full directory…</span>
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : hierarchy.roots.length === 0 ? (
          <EmptyState title="No people to show" description="No users were returned for you." />
        ) : search && search.matchIds.size === 0 ? (
          <EmptyState
            title="Nobody matches that search"
            description="Try a different name, email, role, or department."
          />
        ) : (
          <ul role="tree" aria-label="Reporting hierarchy" className="space-y-0.5">
            {hierarchy.roots.map((node) => (
              <OrgNode
                key={node.user.id}
                node={node}
                depth={0}
                expanded={expanded}
                onToggle={toggle}
                matchIds={search?.matchIds ?? new Set()}
                visibleIds={search?.visibleIds ?? null}
                roleName={(roleId) => roleNames.get(roleId) ?? null}
                departmentName={(departmentId) =>
                  departmentId ? (departmentNames.get(departmentId) ?? null) : null
                }
                query={query}
                density={densityRowClass(tableDensity)}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
