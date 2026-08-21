import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../app/AuthContext';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { Pagination } from '../../components/ui/Pagination';
import { DataCell, DataRow, RowActions } from '../../components/ui/DataTable';
import { PurgeDialog } from '../../components/ui/PurgeDialog';
import { adminApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import type { AdminRole } from '../../types/domain';
import { SearchableSelect } from './SearchableSelect';
import { PageBody, PageHeader } from '../../components/layout/PageFrame';
import { usePageChrome } from '../../app/page-chrome';
import { ActiveFilter, AdminTable, activeValue, ADMIN_PAGE_SIZE } from './shared';

type RoleDraft = { id?: string; key: string; name: string };
export function RolesPage() {
  usePageChrome('Roles', [['admin', 'roles']]);
  const { can } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [active, setActive] = useState('true');
  const [draft, setDraft] = useState<RoleDraft | null>(null);
  const [deactivating, setDeactivating] = useState<AdminRole | null>(null);
  const [purging, setPurging] = useState<AdminRole | null>(null);
  const [replacementRoleId, setReplacementRoleId] = useState('');
  const query = useQuery({
    queryKey: ['admin', 'roles', page, active],
    queryFn: () => adminApi.roles(page, activeValue(active)),
  });
  const loadRoles = useCallback(
    async (nextPage: number) => {
      const result = await adminApi.roles(nextPage, true);
      return { ...result, items: result.items.filter((role) => role.id !== deactivating?.id) };
    },
    [deactivating?.id],
  );
  const save = useMutation({
    mutationFn: () =>
      draft?.id
        ? adminApi.editRole(draft.id, { name: draft.name })
        : adminApi.createRole({ key: draft?.key ?? '', name: draft?.name ?? '' }),
    onSuccess: async () => {
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
    },
  });
  const deactivate = useMutation({
    mutationFn: () =>
      adminApi.deactivateRole(deactivating?.id ?? '', replacementRoleId || undefined),
    onSuccess: async () => {
      setDeactivating(null);
      setReplacementRoleId('');
      await qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
    },
  });
  const purge = useMutation({
    mutationFn: (id: string) => adminApi.purgeRole(id),
    onSuccess: async () => {
      setPurging(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
    },
  });
  // Kept out of the page banner: a purge refusal names what still holds the
  // Role, and that belongs beside the Role being deleted.
  const error = query.error ?? save.error ?? deactivate.error;
  return (
    <PageBody>
      <PageHeader
        title="Roles & permissions"
        description="Roles are configurable grant profiles; names never confer access."
        actions={
          can('roles_permissions', 'create') ? (
            <Button onClick={() => setDraft({ key: '', name: '' })}>Create Role</Button>
          ) : undefined
        }
      />
      {error ? <Banner tone="error">{friendlyErrorMessage(error)}</Banner> : null}
      {draft ? (
        <Card className="grid gap-3 p-4 sm:grid-cols-2">
          <Field label="Stable key" required>
            {({ inputId }) => (
              <Input
                id={inputId}
                disabled={Boolean(draft.id)}
                value={draft.key}
                onChange={(event) => setDraft({ ...draft, key: event.target.value })}
              />
            )}
          </Field>
          <Field label="Name" required>
            {({ inputId }) => (
              <Input
                id={inputId}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            )}
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button
              loading={save.isPending}
              disabled={!draft.name || (!draft.id && !draft.key)}
              onClick={() => save.mutate()}
            >
              Save Role
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}
      {deactivating ? (
        <Card className="space-y-3 p-4">
          <h3 className="font-display text-lg font-semibold">Deactivate {deactivating.name}</h3>
          <p className="text-sm text-ink-soft">
            Choose an active replacement role for any users currently assigned to this role.
          </p>
          <Field label="Replacement role">
            {({ inputId }) => (
              <SearchableSelect
                id={inputId}
                value={replacementRoleId}
                onChange={setReplacementRoleId}
                loadPage={loadRoles}
                placeholder="Select replacement role"
              />
            )}
          </Field>
          <div className="flex gap-2">
            <Button
              variant="danger"
              loading={deactivate.isPending}
              disabled={!replacementRoleId}
              onClick={() => deactivate.mutate()}
            >
              Deactivate Role
            </Button>
            <Button variant="ghost" onClick={() => setDeactivating(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}
      <ActiveFilter
        id="role-active"
        value={active}
        onChange={(value) => {
          setActive(value);
          setPage(1);
        }}
      />
      <AdminTable
        loading={query.isPending}
        headers={['Name', 'Stable key', 'State', { label: 'Actions', align: 'right' as const }]}
        empty={!query.isPending && !query.data?.items.length}
      >
        {query.data?.items.map((role) => (
          <DataRow key={role.id}>
            <DataCell primary>{role.name}</DataCell>
            <DataCell>{role.key}</DataCell>
            <DataCell>{role.active ? 'Active' : 'Inactive'}</DataCell>
            <DataCell align="right">
              <div className="flex items-center justify-end gap-2">
                <Link className="text-sm font-medium underline" to={`/admin/roles/${role.id}`}>
                  Manage permissions
                </Link>
                <RowActions>
                  {can('roles_permissions', 'edit') ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDraft({ id: role.id, key: role.key, name: role.name })}
                    >
                      Edit
                    </Button>
                  ) : null}
                  {can('roles_permissions', 'edit') && role.active ? (
                    <Button size="sm" variant="danger" onClick={() => setDeactivating(role)}>
                      Deactivate
                    </Button>
                  ) : null}
                  {can('roles_permissions', 'purge') && !role.active ? (
                    <Button size="sm" variant="danger" onClick={() => setPurging(role)}>
                      Delete permanently
                    </Button>
                  ) : null}
                </RowActions>
              </div>
            </DataCell>
          </DataRow>
        ))}
      </AdminTable>
      {query.data ? (
        <Pagination
          page={query.data.page}
          pageSize={query.data.pageSize || ADMIN_PAGE_SIZE}
          total={query.data.total}
          onPageChange={setPage}
        />
      ) : null}
      {purging ? (
        <PurgeDialog
          entityLabel="Role"
          entityKey={purging.key}
          entityName={purging.name}
          loading={purge.isPending}
          error={purge.error}
          onCancel={() => {
            purge.reset();
            setPurging(null);
          }}
          onConfirm={() => purge.mutate(purging.id)}
        />
      ) : null}
    </PageBody>
  );
}
