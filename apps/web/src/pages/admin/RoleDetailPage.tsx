import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Popover } from '../../components/ui/Popover';
import { Select } from '../../components/ui/Select';
import { PageBody, PageHeader, SectionCard } from '../../components/layout/PageFrame';
import { adminApi } from '../../lib/api-client';
import { ApiError, friendlyErrorMessage } from '../../lib/api-error';
import { cn } from '../../lib/cn';
import type { CapabilitySet, DataScope, FieldAccessLevel } from '../../types/domain';
import { usePageChrome } from '../../app/page-chrome';
import { useUnsavedChanges } from '../../app/use-unsaved-changes';
import { loadAllPages } from './shared';
import {
  actionHint,
  actionLabel,
  hasPermission,
  isActionScoped,
  journeyLimit,
  moduleSelection,
  normalizeScopes,
  reportingRolesScopeHint,
  setAll,
  setJourneyLimit,
  setModule,
  setPermission,
  setScopeForAll,
  scopeHint,
  scopeLabel,
  unscopedHint,
  type CatalogModule,
} from './permission-matrix';

/** Save/Reset/dirty affordance, identical for all three axes. */
function AxisActions({
  dirty,
  saving,
  onSave,
  onReset,
  label,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
  label: string;
}) {
  return (
    <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
      <Button size="sm" disabled={!dirty} loading={saving} onClick={onSave}>
        {label}
      </Button>
      <Button variant="ghost" size="sm" disabled={!dirty} onClick={onReset}>
        Reset
      </Button>
      {dirty ? (
        <span className="rounded-pill bg-status-calllater-bg px-2 py-0.5 text-xs font-medium text-status-calllater">
          Unsaved changes
        </span>
      ) : null}
    </div>
  );
}

/**
 * ADR-0026 — the optional "Only in journeys…" limit on one granted action.
 *
 * Offers the role's accessible journeys (the Journey access axis as currently
 * edited, saved or not), because a limit naming a journey the role cannot
 * reach grants nothing there. A journey already in the limit that the role no
 * longer reaches is still listed, marked, so it can be seen and removed rather
 * than kept invisibly.
 */
function JourneyLimitControl({
  label,
  selected,
  accessibleIds,
  journeys,
  onChange,
}: {
  /** Names the grant, e.g. "Leads view". */
  label: string;
  selected: readonly string[];
  accessibleIds: readonly string[];
  journeys: readonly { id: string; name: string }[];
  onChange: (journeyIds: string[]) => void;
}) {
  const nameOf = (id: string) =>
    journeys.find((journey) => journey.id === id)?.name ?? 'Inactive journey';
  const options = [...accessibleIds, ...selected.filter((id) => !accessibleIds.includes(id))];
  const summary =
    selected.length === 0
      ? 'Only in journeys…'
      : selected.length === 1
        ? `Only in ${nameOf(selected[0]!)}`
        : `Only in ${selected.length} journeys`;
  // Kept in option order so ticking and unticking a journey returns the row
  // to exactly what it was, rather than an equal set that reads as an edit.
  const toggle = (id: string, checked: boolean) =>
    onChange(options.filter((option) => (option === id ? checked : selected.includes(option))));
  return (
    <Popover
      label={`${label} journeys`}
      align="left"
      trigger={
        <>
          <span className="sr-only">{label} journeys: </span>
          {summary}
        </>
      }
      triggerClassName={cn(
        'text-xs underline-offset-2 hover:text-ink hover:underline',
        selected.length ? 'font-medium text-ink' : 'text-ink-soft',
      )}
      panelClassName="w-64 p-3"
    >
      <p className="mb-2 text-xs text-ink-soft">
        Leave every journey unticked to apply this grant in all journeys the role can access.
      </p>
      {options.length === 0 ? (
        <p className="text-xs text-ink-soft">This role has no journey access yet.</p>
      ) : (
        <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
          {options.map((id) => (
            <Checkbox
              key={id}
              label={accessibleIds.includes(id) ? nameOf(id) : `${nameOf(id)} (no access)`}
              checked={selected.includes(id)}
              onChange={(event) => toggle(id, event.target.checked)}
            />
          ))}
        </div>
      )}
      {selected.length ? (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => onChange([])}>
          All journeys
        </Button>
      ) : null}
    </Popover>
  );
}

/**
 * The admin routes send a refused reporting line as a bare `validation_error`
 * — the repository's reason ("cannot form a cycle", "cannot report to itself")
 * isn't on the wire — so name the only things a 400 here can mean rather than
 * the generic "some fields need a second look". A reason, if one is ever
 * sent, wins.
 */
function reportingLinesErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'validation_error' && !error.reason)
    return 'These reporting lines were refused: a role cannot report to itself, or to a role that already reports to it at any depth — that would form a cycle.';
  return friendlyErrorMessage(error);
}

export function RoleDetailPage() {
  const { roleId = '' } = useParams();
  usePageChrome('Role', [['admin', 'role', roleId]]);
  const qc = useQueryClient();
  const { refreshCapabilities } = useAuth();
  const role = useQuery({
    queryKey: ['admin', 'role', roleId],
    queryFn: () => adminApi.role(roleId),
  });
  const catalog = useQuery({ queryKey: ['permission-catalog'], queryFn: adminApi.catalog });
  const journeys = useQuery({
    queryKey: ['admin', 'journeys', 'role-editor'],
    queryFn: () => loadAllPages((page, pageSize) => adminApi.journeys(page, true, pageSize)),
  });
  const fields = useQuery({
    queryKey: ['admin', 'fields', 'role-editor'],
    queryFn: () => loadAllPages((page, pageSize) => adminApi.fields(page, true, pageSize)),
  });
  const roles = useQuery({
    queryKey: ['admin', 'roles', 'role-editor'],
    queryFn: () => loadAllPages((page, pageSize) => adminApi.roles(page, true, pageSize)),
  });
  // Under the role's own key, so every axis's save refreshes it too.
  const reportingLines = useQuery({
    queryKey: ['admin', 'role', roleId, 'reporting-lines'],
    queryFn: () => adminApi.reportingLines(roleId),
  });

  const [permissions, setPermissions] = useState<CapabilitySet['permissions']>([]);
  const [journeyIds, setJourneyIds] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<CapabilitySet['fieldVisibility']>([]);
  const [syncedRole, setSyncedRole] = useState(role.data);
  if (role.data && role.data !== syncedRole) {
    setSyncedRole(role.data);
    setPermissions(role.data.permissions ?? []);
    setJourneyIds((role.data.journeyAccess ?? []).map((x) => x.journeyId));
    setVisibility(role.data.fieldVisibility ?? []);
  }
  const [reportsTo, setReportsTo] = useState<string[]>([]);
  const [syncedLines, setSyncedLines] = useState(reportingLines.data);
  if (reportingLines.data && reportingLines.data !== syncedLines) {
    setSyncedLines(reportingLines.data);
    setReportsTo(reportingLines.data.reportsToRoleIds);
  }

  const saved = async () => {
    await qc.invalidateQueries({ queryKey: ['admin', 'role', roleId] });
    // Capabilities aren't a cached query — invalidating a key here matched
    // nothing, so an admin editing their own role kept the old `can()` until a
    // reload. Ask the provider to re-read them instead.
    await refreshCapabilities();
  };
  const savePermissions = useMutation({
    // Normalized at the boundary, not on every edit: corrects a role saved
    // before this action was recognized as unscoped, or one just bulk-
    // rescoped by "Set all scopes…" (which applies one value to every
    // granted row without knowing which are unscoped), without needing a
    // data migration for rows that were never behaviorally wrong.
    mutationFn: () => adminApi.savePermissions(roleId, normalizeScopes(permissions, modules)),
    onSuccess: saved,
  });
  const saveJourneys = useMutation({
    mutationFn: () => adminApi.saveJourneyAccess(roleId, journeyIds),
    onSuccess: saved,
  });
  const saveVisibility = useMutation({
    mutationFn: () => adminApi.saveFieldVisibility(roleId, visibility),
    onSuccess: saved,
  });
  // No capability refresh: reporting lines widen what a Reporting roles scope
  // resolves to at request time, not which actions the caller holds.
  const saveReportingLines = useMutation({
    mutationFn: () => adminApi.saveReportingLines(roleId, reportsTo),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'role', roleId] }),
  });

  const error =
    role.error ??
    catalog.error ??
    journeys.error ??
    fields.error ??
    roles.error ??
    reportingLines.error ??
    savePermissions.error ??
    saveJourneys.error ??
    saveVisibility.error;

  const originalPermissions = role.data?.permissions ?? [];
  const originalJourneyIds = (role.data?.journeyAccess ?? []).map((row) => row.journeyId);
  const originalVisibility = role.data?.fieldVisibility ?? [];
  const permissionDirty = JSON.stringify(permissions) !== JSON.stringify(originalPermissions);
  const journeyDirty =
    JSON.stringify([...journeyIds].sort()) !== JSON.stringify([...originalJourneyIds].sort());
  const visibilityDirty =
    JSON.stringify([...visibility].sort((a, b) => a.fieldId.localeCompare(b.fieldId))) !==
    JSON.stringify([...originalVisibility].sort((a, b) => a.fieldId.localeCompare(b.fieldId)));
  const originalReportsTo = reportingLines.data?.reportsToRoleIds ?? [];
  const reportsToDirty =
    JSON.stringify([...reportsTo].sort()) !== JSON.stringify([...originalReportsTo].sort());
  useUnsavedChanges(permissionDirty || journeyDirty || visibilityDirty || reportsToDirty);

  const modules: CatalogModule[] = catalog.data?.modules ?? [];
  const grantedCount = permissions.length;
  const totalCount = modules.reduce((sum, module) => sum + module.actions.length, 0);
  const allJourneysSelected =
    (journeys.data ?? []).length > 0 && journeyIds.length === (journeys.data ?? []).length;
  const otherRoles = (roles.data ?? []).filter((candidate) => candidate.id !== roleId);
  // A line to a since-deactivated role isn't offered as a checkbox, but it
  // stays in the saved set untouched rather than being dropped on save.
  const unlistedReportsTo = roles.data
    ? reportsTo.filter((id) => !otherRoles.some((candidate) => candidate.id === id)).length
    : 0;

  return (
    <PageBody>
      <PageHeader
        title={role.data?.name ?? 'Role'}
        description="Each Save replaces the complete desired state for that axis."
        breadcrumb={
          <Link to="/admin/roles" className="text-xs text-ink-soft hover:text-ink">
            ← Roles &amp; permissions
          </Link>
        }
      />

      {error ? <Banner tone="error">{friendlyErrorMessage(error)}</Banner> : null}

      <SectionCard
        title="Feature permissions"
        description={`${grantedCount} of ${totalCount} actions granted.`}
        actions={
          <>
            {/*
              Bulk edits stay one request: these mutate the same desired-state
              array the single Save already sends, so there is no partial apply.
            */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPermissions(setAll(permissions, modules, true))}
            >
              Grant all
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setPermissions([])}>
              Clear all
            </Button>
            <Select
              aria-label="Apply scope to every granted action"
              className="w-40"
              value=""
              onChange={(event) => {
                if (event.target.value)
                  setPermissions(setScopeForAll(permissions, event.target.value as DataScope));
              }}
            >
              <option value="">Set all scopes…</option>
              {catalog.data?.supportedScopes.map((scope) => (
                <option key={scope} value={scope}>
                  {scopeLabel(scope)}
                </option>
              ))}
            </Select>
          </>
        }
      >
        <div className="space-y-5">
          {/*
            Two things in this product are called "team" and they are unrelated
            (ADR-0014). Saying so where the scope is actually chosen is the
            mitigation; anywhere else is too late.
          */}
          <div className="space-y-1 rounded-control bg-paper px-3 py-2 text-xs text-ink-soft">
            <p>{scopeHint}</p>
            {catalog.data?.supportedScopes.includes('REPORTING_ROLES') ? (
              <p>{reportingRolesScopeHint}</p>
            ) : null}
          </div>
          {modules.map((module) => {
            const selection = moduleSelection(permissions, module);
            return (
              <fieldset key={module.module}>
                <div className="mb-2 flex items-center justify-between gap-3 border-b border-line pb-1.5">
                  <legend className="font-display text-sm font-bold text-ink">
                    {module.label}
                  </legend>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink-soft">
                      {selection === 'all' ? 'All' : selection === 'none' ? 'None' : 'Partial'}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setPermissions(setModule(permissions, module, selection !== 'all'))
                      }
                    >
                      {selection === 'all' ? 'Clear module' : 'Select module'}
                    </Button>
                  </div>
                </div>
                <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                  {module.actions.map((action) => {
                    const row = permissions.find(
                      (x) => x.module === module.module && x.action === action,
                    );
                    return (
                      <div
                        className={cn(
                          'grid grid-cols-[1fr_9rem] items-center gap-x-2 gap-y-0.5 rounded-control px-2 py-1',
                          row ? 'bg-paper' : '',
                        )}
                        key={action}
                      >
                        <span className="min-w-0" title={actionHint(action)}>
                          <Checkbox
                            label={actionLabel(action)}
                            checked={hasPermission(permissions, module.module, action)}
                            onChange={(e) =>
                              setPermissions(
                                setPermission(permissions, module.module, action, e.target.checked),
                              )
                            }
                          />
                        </span>
                        {isActionScoped(module, action) ? (
                          <Select
                            aria-label={`${module.label} ${action} scope`}
                            disabled={!row}
                            value={row?.scope ?? 'SELF'}
                            onChange={(e) =>
                              setPermissions((rows) =>
                                rows.map((x) =>
                                  x.module === module.module && x.action === action
                                    ? { ...x, scope: e.target.value as DataScope }
                                    : x,
                                ),
                              )
                            }
                          >
                            {catalog.data?.supportedScopes.map((scope) => (
                              <option key={scope} value={scope}>
                                {scopeLabel(scope)}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          // ADR-0022: this action's scope is never consulted by
                          // anything — a real selector here would offer a choice
                          // that silently does nothing, whichever option is picked.
                          <span className="text-xs text-ink-soft" title={unscopedHint}>
                            Always organization-wide
                          </span>
                        )}
                        {row ? (
                          <div className="col-span-2 pl-6">
                            <JourneyLimitControl
                              label={`${module.label} ${action}`}
                              selected={journeyLimit(permissions, module.module, action)}
                              accessibleIds={journeyIds}
                              journeys={journeys.data ?? []}
                              onChange={(ids) =>
                                setPermissions((rows) =>
                                  setJourneyLimit(rows, module.module, action, ids),
                                )
                              }
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
        </div>
        <AxisActions
          dirty={permissionDirty}
          saving={savePermissions.isPending}
          onSave={() => savePermissions.mutate()}
          onReset={() => setPermissions(originalPermissions)}
          label="Save feature permissions"
        />
      </SectionCard>

      <SectionCard
        title="Journey access"
        description={`${journeyIds.length} of ${(journeys.data ?? []).length} journeys.`}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setJourneyIds(allJourneysSelected ? [] : (journeys.data ?? []).map((j) => j.id))
            }
          >
            {allJourneysSelected ? 'Clear all' : 'Select all'}
          </Button>
        }
      >
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {journeys.data?.map((journey) => (
            <Checkbox
              key={journey.id}
              label={journey.name}
              checked={journeyIds.includes(journey.id)}
              onChange={(e) =>
                setJourneyIds((ids) =>
                  e.target.checked ? [...ids, journey.id] : ids.filter((id) => id !== journey.id),
                )
              }
            />
          ))}
        </div>
        <AxisActions
          dirty={journeyDirty}
          saving={saveJourneys.isPending}
          onSave={() => saveJourneys.mutate()}
          onReset={() => setJourneyIds(originalJourneyIds)}
          label="Save Journey access"
        />
      </SectionCard>

      <SectionCard
        title="Field visibility"
        description="Fields with no entry are hidden entirely and stripped server-side."
        actions={
          <Select
            aria-label="Apply visibility to every field"
            className="w-44"
            value=""
            onChange={(event) => {
              const level = event.target.value;
              if (!level) return;
              setVisibility(
                level === 'HIDDEN'
                  ? []
                  : (fields.data ?? []).map((field) => ({
                      fieldId: field.id,
                      accessLevel: level as FieldAccessLevel,
                    })),
              );
            }}
          >
            <option value="">Set all fields…</option>
            <option value="HIDDEN">Hidden</option>
            <option value="VIEW">View</option>
            <option value="EDIT">Edit</option>
          </Select>
        }
      >
        <div className="grid gap-1.5 sm:grid-cols-2">
          {fields.data?.map((field) => (
            <div
              className="grid grid-cols-[1fr_9rem] items-center gap-2 rounded-control px-2 py-1"
              key={field.id}
            >
              <span className="truncate text-sm text-ink">{field.name}</span>
              <Select
                aria-label={`${field.name} visibility`}
                value={visibility.find((x) => x.fieldId === field.id)?.accessLevel ?? 'HIDDEN'}
                onChange={(e) =>
                  setVisibility((rows) => {
                    const next = rows.filter((x) => x.fieldId !== field.id);
                    return e.target.value === 'HIDDEN'
                      ? next
                      : [
                          ...next,
                          { fieldId: field.id, accessLevel: e.target.value as FieldAccessLevel },
                        ];
                  })
                }
              >
                <option value="HIDDEN">Hidden</option>
                <option value="VIEW">View</option>
                <option value="EDIT">Edit</option>
              </Select>
            </div>
          ))}
        </div>
        <AxisActions
          dirty={visibilityDirty}
          saving={saveVisibility.isPending}
          onSave={() => saveVisibility.mutate()}
          onReset={() => setVisibility(originalVisibility)}
          label="Save Field visibility"
        />
      </SectionCard>

      <SectionCard
        title="Reports to"
        description="Users of this role see leads owned by users of every role that reports to it (Reporting roles scope)."
      >
        <p className="mb-3 text-xs text-ink-soft">
          Tick the roles this role reports to. Lines may branch — a role can report to several — but
          never loop back to itself.
        </p>
        {saveReportingLines.error ? (
          <div className="mb-3">
            <Banner tone="error">{reportingLinesErrorMessage(saveReportingLines.error)}</Banner>
          </div>
        ) : null}
        {roles.data && otherRoles.length === 0 ? (
          <p className="text-sm text-ink-soft">There are no other active roles to report to.</p>
        ) : null}
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {otherRoles.map((candidate) => (
            <Checkbox
              key={candidate.id}
              label={candidate.name}
              checked={reportsTo.includes(candidate.id)}
              onChange={(e) =>
                setReportsTo((ids) =>
                  e.target.checked
                    ? [...ids, candidate.id]
                    : ids.filter((id) => id !== candidate.id),
                )
              }
            />
          ))}
        </div>
        {unlistedReportsTo ? (
          <p className="mt-2 text-xs text-ink-soft">
            {`Also reports to ${unlistedReportsTo} inactive ${unlistedReportsTo === 1 ? 'role' : 'roles'}, kept as is.`}
          </p>
        ) : null}
        <AxisActions
          dirty={reportsToDirty}
          saving={saveReportingLines.isPending}
          onSave={() => saveReportingLines.mutate()}
          onReset={() => {
            saveReportingLines.reset();
            setReportsTo(originalReportsTo);
          }}
          label="Save reporting lines"
        />
      </SectionCard>
    </PageBody>
  );
}
