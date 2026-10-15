import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../app/AuthContext';
import { useUnsavedChanges } from '../../../app/use-unsaved-changes';
import { Banner } from '../../../components/ui/Banner';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Field } from '../../../components/ui/Field';
import { Select } from '../../../components/ui/Select';
import { adminApi } from '../../../lib/api-client';
import { friendlyErrorMessage } from '../../../lib/api-error';
import type { FieldRequirement, Status } from '../../../types/domain';
import { CheckboxMultiSelect, type MultiSelectOption } from './CheckboxMultiSelect';
import { useActiveRoleOptions, type JourneyFieldRow } from './queries';

type SettingDraft = {
  fieldId: string;
  requirement: FieldRequirement;
  requiredFromStatusId: string;
  /** Only sent with `required_on_create`; empty = every role. */
  requiredRoleIds: string[];
};

const REQUIREMENTS: ReadonlyArray<{ value: FieldRequirement; label: string }> = [
  { value: 'required', label: 'Required' },
  { value: 'optional', label: 'Optional' },
  { value: 'hidden', label: 'Hidden' },
  { value: 'required_on_create', label: 'Required when adding a lead' },
];
const requirementLabel = (value: string) =>
  REQUIREMENTS.find((option) => option.value === value)?.label ?? value;

/**
 * The PUT body. The API refuses a narrowing that would never be enforced — a
 * required-from Status on anything but `required`, roles on anything but
 * `required_on_create` — so each is sent only with its own requirement.
 */
function settingBody(draft: SettingDraft) {
  return {
    requirement: draft.requirement,
    requiredFromStatusId:
      draft.requirement === 'required' ? draft.requiredFromStatusId || null : null,
    ...(draft.requirement === 'required_on_create'
      ? { requiredRoleIds: draft.requiredRoleIds }
      : {}),
  };
}

/** Which Fields this Journey uses, and the requirement rule on each. */
export function JourneyFieldsTab({
  journeyId,
  statuses,
  settings,
}: {
  journeyId: string;
  statuses: Status[];
  settings: JourneyFieldRow[];
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [settingDraft, setSettingDraft] = useState<SettingDraft | null>(null);
  const canListRoles = can('roles_permissions', 'view');
  const fields = useQuery({
    queryKey: ['admin', 'fields', 'journey-editor'],
    queryFn: () => adminApi.fields(1, true),
  });
  // Needed for the editor's role picker and to name the roles on each row.
  const roles = useActiveRoleOptions(canListRoles);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['admin', 'journey-fields', journeyId] });
    // Status rules may only require shown Fields, so a mapping change can
    // change what the Statuses tab offers.
    await qc.invalidateQueries({ queryKey: ['admin', 'journey', journeyId] });
  };
  const saveSetting = useMutation({
    mutationFn: () =>
      adminApi.setJourneyField(
        journeyId,
        settingDraft?.fieldId ?? '',
        settingBody(settingDraft ?? emptySetting()),
      ),
    onSuccess: async () => {
      setSettingDraft(null);
      await refresh();
    },
  });
  const unmap = useMutation({
    mutationFn: (fieldId: string) => adminApi.unmapJourneyField(journeyId, fieldId),
    onSuccess: refresh,
  });
  const error = fields.error ?? roles.error ?? saveSetting.error ?? unmap.error;
  useUnsavedChanges(settingDraft !== null);
  const roleName = (id: string) => roles.data?.find((role) => role.id === id)?.name;
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap justify-between gap-2">
        <h3 className="font-display text-lg font-semibold">Journey Fields</h3>
        {can('fields', 'edit') ? (
          <Button size="sm" onClick={() => setSettingDraft(emptySetting())}>
            Attach Field
          </Button>
        ) : null}
      </div>
      {error ? <Banner tone="error">{friendlyErrorMessage(error)}</Banner> : null}
      {settingDraft ? (
        <SettingEditor
          draft={settingDraft}
          setDraft={setSettingDraft}
          fields={fields.data?.items ?? []}
          statuses={statuses}
          roleOptions={canListRoles ? (roles.data ?? []) : null}
          rolesLoading={roles.isPending}
          save={() => saveSetting.mutate()}
          cancel={() => setSettingDraft(null)}
          loading={saveSetting.isPending}
        />
      ) : null}
      <ul className="divide-y">
        {settings.map((setting) => {
          const requiredRoleIds = setting.requiredRoleIds ?? [];
          return (
            <li
              className="flex flex-wrap items-center justify-between gap-3 py-3"
              key={setting.fieldId}
            >
              <div>
                <span className="font-medium">{setting.field.name}</span>
                <span className="ml-2 text-sm text-ink-soft">
                  {requirementLabel(setting.requirement)}
                  {setting.requiredFromStatusId
                    ? ` from ${statuses.find((status) => status.id === setting.requiredFromStatusId)?.name ?? 'configured Status'}`
                    : ''}
                  {setting.requirement === 'required_on_create'
                    ? requiredRoleIds.length === 0
                      ? ' · every role'
                      : ` · ${requiredRoleIds.map((id) => roleName(id) ?? 'a role').join(', ')}`
                    : ''}
                </span>
              </div>
              {can('fields', 'edit') ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setSettingDraft({
                        fieldId: setting.fieldId,
                        requirement: setting.requirement as FieldRequirement,
                        requiredFromStatusId: setting.requiredFromStatusId ?? '',
                        requiredRoleIds,
                      })
                    }
                  >
                    Edit rule
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => unmap.mutate(setting.fieldId)}>
                    Unmap
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function emptySetting(): SettingDraft {
  return { fieldId: '', requirement: 'optional', requiredFromStatusId: '', requiredRoleIds: [] };
}

function SettingEditor({
  draft,
  setDraft,
  fields,
  statuses,
  roleOptions,
  rolesLoading,
  save,
  cancel,
  loading,
}: {
  draft: SettingDraft;
  setDraft: (draft: SettingDraft) => void;
  fields: Array<{ id: string; name: string }>;
  statuses: Status[];
  /** Null when the viewer cannot list roles; stored roles are then sent back as they were. */
  roleOptions: readonly MultiSelectOption[] | null;
  rolesLoading: boolean;
  save: () => void;
  cancel: () => void;
  loading: boolean;
}) {
  return (
    <div className="grid gap-3 rounded-control border bg-paper p-3 sm:grid-cols-3">
      <Field label="Field" required>
        {({ inputId }) => (
          <Select
            id={inputId}
            disabled={Boolean(draft.fieldId && fields.some((field) => field.id === draft.fieldId))}
            value={draft.fieldId}
            onChange={(event) => setDraft({ ...draft, fieldId: event.target.value })}
          >
            <option value="">Select Field</option>
            {fields.map((field) => (
              <option key={field.id} value={field.id}>
                {field.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Requirement">
        {({ inputId }) => (
          <Select
            id={inputId}
            value={draft.requirement}
            onChange={(event) =>
              setDraft({ ...draft, requirement: event.target.value as FieldRequirement })
            }
          >
            {REQUIREMENTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {draft.requirement === 'required' ? (
        <Field label="Required from Status">
          {({ inputId }) => (
            <Select
              id={inputId}
              value={draft.requiredFromStatusId}
              onChange={(event) => setDraft({ ...draft, requiredFromStatusId: event.target.value })}
            >
              <option value="">No Status condition</option>
              {statuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      {draft.requirement === 'required_on_create' && roleOptions ? (
        <div className="sm:col-span-3">
          <CheckboxMultiSelect
            legend="for these roles (empty = everyone)"
            hint="Checked only when a lead is created, and only for users in these roles. Existing leads are never blocked by it."
            options={roleOptions}
            loading={rolesLoading}
            value={draft.requiredRoleIds}
            onChange={(requiredRoleIds) => setDraft({ ...draft, requiredRoleIds })}
          />
        </div>
      ) : null}
      <div className="flex gap-2 sm:col-span-3">
        <Button loading={loading} disabled={!draft.fieldId} onClick={save}>
          Save Field rule
        </Button>
        <Button variant="ghost" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
