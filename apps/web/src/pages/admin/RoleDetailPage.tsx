import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Checkbox } from '../../components/ui/Checkbox';
import { Select } from '../../components/ui/Select';
import { adminApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import type { CapabilitySet, DataScope, FieldAccessLevel } from '../../types/domain';
import { loadAllPages } from './shared';

export function RoleDetailPage() {
  const { roleId = '' } = useParams();
  const qc = useQueryClient();
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
    await qc.invalidateQueries({ queryKey: ['auth-capabilities'] });
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
  const togglePermission = (module: string, action: string, checked: boolean) =>
    setPermissions((rows) =>
      checked
        ? [...rows, { module, action, scope: 'SELF' }]
        : rows.filter((x) => x.module !== module || x.action !== action),
    );
  const originalPermissions = role.data?.permissions ?? [];
  const originalJourneyIds = (role.data?.journeyAccess ?? []).map((row) => row.journeyId);
  const originalVisibility = role.data?.fieldVisibility ?? [];
  const permissionDirty = JSON.stringify(permissions) !== JSON.stringify(originalPermissions);
  const journeyDirty =
    JSON.stringify([...journeyIds].sort()) !== JSON.stringify([...originalJourneyIds].sort());
  const visibilityDirty =
    JSON.stringify([...visibility].sort((a, b) => a.fieldId.localeCompare(b.fieldId))) !==
    JSON.stringify([...originalVisibility].sort((a, b) => a.fieldId.localeCompare(b.fieldId)));
  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div>
        <h2 className="font-display text-2xl font-bold">{role.data?.name ?? 'Role'}</h2>
        <p className="text-sm text-ink-soft">
          Each Save replaces the complete desired state for that axis.
        </p>
      </div>
      {error && <Banner tone="error">{friendlyErrorMessage(error)}</Banner>}
      <Card className="space-y-4 p-4">
        <h3 className="font-display text-lg font-semibold">Feature permissions</h3>
        {catalog.data?.modules.map((module) => (
          <fieldset className="space-y-2 border-t pt-3" key={module.module}>
            <legend className="font-medium">{module.label}</legend>
            {module.actions.map((action) => {
              const row = permissions.find(
                (x) => x.module === module.module && x.action === action,
              );
              return (
                <div className="grid grid-cols-[1fr_12rem] gap-3" key={action}>
                  <Checkbox
                    label={action.replaceAll('_', ' ')}
                    checked={Boolean(row)}
                    onChange={(e) => togglePermission(module.module, action, e.target.checked)}
                  />
                  <Select
                    aria-label={`${module.label} ${action} scope`}
                    disabled={!row}
                    value={row?.scope ?? 'SELF'}
                    onChange={(e) =>
                      setPermissions((rows) =>
                        rows.map((x) =>
                          x === row ? { ...x, scope: e.target.value as DataScope } : x,
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
          </fieldset>
        ))}
        <div className="flex items-center gap-2">
          <Button
            disabled={!permissionDirty}
            loading={savePermissions.isPending}
            onClick={() => savePermissions.mutate()}
          >
            Save feature permissions
          </Button>
          <Button
            variant="ghost"
            disabled={!permissionDirty}
            onClick={() => setPermissions(originalPermissions)}
          >
            Reset
          </Button>
          {permissionDirty ? <span className="text-sm text-ink-soft">Unsaved changes</span> : null}
        </div>
      </Card>
      <Card className="space-y-3 p-4">
        <h3 className="font-display text-lg font-semibold">Journey access</h3>
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
        <div>
          <div className="flex items-center gap-2">
            <Button
              disabled={!journeyDirty}
              loading={saveJourneys.isPending}
              onClick={() => saveJourneys.mutate()}
            >
              Save Journey access
            </Button>
            <Button
              variant="ghost"
              disabled={!journeyDirty}
              onClick={() => setJourneyIds(originalJourneyIds)}
            >
              Reset
            </Button>
            {journeyDirty ? <span className="text-sm text-ink-soft">Unsaved changes</span> : null}
          </div>
        </div>
      </Card>
      <Card className="space-y-3 p-4">
        <h3 className="font-display text-lg font-semibold">Field visibility</h3>
        {fields.data?.map((field) => (
          <div className="grid grid-cols-[1fr_12rem] items-center gap-3" key={field.id}>
            <span>{field.name}</span>
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
        <div className="flex items-center gap-2">
          <Button
            disabled={!visibilityDirty}
            loading={saveVisibility.isPending}
            onClick={() => saveVisibility.mutate()}
          >
            Save Field visibility
          </Button>
          <Button
            variant="ghost"
            disabled={!visibilityDirty}
            onClick={() => setVisibility(originalVisibility)}
          >
            Reset
          </Button>
          {visibilityDirty ? <span className="text-sm text-ink-soft">Unsaved changes</span> : null}
        </div>
      </Card>
    </div>
  );
}
