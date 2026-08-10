import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Select } from '../../components/ui/Select';
import { PageBody, PageHeader, SectionCard } from '../../components/layout/PageFrame';
import { adminApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import { cn } from '../../lib/cn';
import type { CapabilitySet, DataScope, FieldAccessLevel } from '../../types/domain';
import { usePageChrome } from '../../app/page-chrome';
import { loadAllPages } from './shared';
import {
  hasPermission,
  moduleSelection,
  setAll,
  setModule,
  setPermission,
  setScopeForAll,
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

  const saved = async () => {
    await qc.invalidateQueries({ queryKey: ['admin', 'role', roleId] });
    // Capabilities aren't a cached query — invalidating a key here matched
    // nothing, so an admin editing their own role kept the old `can()` until a
    // reload. Ask the provider to re-read them instead.
    await refreshCapabilities();
  };
  const savePermissions = useMutation({
    mutationFn: () => adminApi.savePermissions(roleId, permissions),
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

  const error =
    role.error ??
    catalog.error ??
    journeys.error ??
    fields.error ??
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

  const modules: CatalogModule[] = catalog.data?.modules ?? [];
  const grantedCount = permissions.length;
  const totalCount = modules.reduce((sum, module) => sum + module.actions.length, 0);
  const allJourneysSelected =
    (journeys.data ?? []).length > 0 && journeyIds.length === (journeys.data ?? []).length;

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
                  {scope}
                </option>
              ))}
            </Select>
          </>
        }
      >
        <div className="space-y-5">
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
                          'grid grid-cols-[1fr_9rem] items-center gap-2 rounded-control px-2 py-1',
                          row ? 'bg-paper' : '',
                        )}
                        key={action}
                      >
                        <Checkbox
                          label={action.replaceAll('_', ' ')}
                          checked={hasPermission(permissions, module.module, action)}
                          onChange={(e) =>
                            setPermissions(
                              setPermission(permissions, module.module, action, e.target.checked),
                            )
                          }
                        />
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
                            <option key={scope}>{scope}</option>
                          ))}
                        </Select>
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
    </PageBody>
  );
}
