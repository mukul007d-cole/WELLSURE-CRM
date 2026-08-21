import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../../app/AuthContext';
import { usePageChrome } from '../../app/page-chrome';
import { useUnsavedDraft } from '../../app/use-unsaved-changes';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { DataCell, DataRow, RowActions } from '../../components/ui/DataTable';
import { PurgeDialog } from '../../components/ui/PurgeDialog';
import { PageBody, PageHeader } from '../../components/layout/PageFrame';
import { adminApi, configApi, notificationsApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import type { NotificationRule, NotificationRuleRecipient } from '../../types/domain';
import { AdminTable } from './shared';

const TRIGGERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'field_edited', label: 'Field edited' },
  { value: 'status_changed', label: 'Status changed' },
  { value: 'lead_reassigned', label: 'Lead reassigned' },
  { value: 'shared_lead_modified_by_non_owner', label: 'Shared lead modified' },
  { value: 'lead_deactivated', label: 'Lead deactivated' },
];

/**
 * The resolver catalog, and — the part the old form was missing — which
 * parameters each one actually reads.
 *
 * `parameters` mirrors `NotificationService.resolve`
 * (`apps/api/src/notifications/service.ts`), not the resolver's name: a
 * resolver that reads nothing from `parameters` gets no input at all rather
 * than a box whose value the server would store and ignore.
 */
type ParameterKind = 'assignment' | 'permission' | 'none';
const RESOLVERS: ReadonlyArray<{
  value: string;
  label: string;
  parameters: ParameterKind;
  hint: string;
}> = [
  {
    value: 'assignment_holder',
    label: 'Assignment holder',
    parameters: 'assignment',
    hint: 'Whoever currently holds this assignment type on the lead.',
  },
  {
    value: 'assignment_holder_manager',
    label: 'Holder’s manager',
    parameters: 'assignment',
    hint: 'That holder’s direct manager in the reporting hierarchy.',
  },
  {
    value: 'previous_assignment_holder',
    label: 'Previous holder',
    parameters: 'none',
    hint: 'Read from the reassignment event itself, so it takes no parameters.',
  },
  {
    value: 'share_creator',
    label: 'Share creator',
    parameters: 'none',
    hint: 'Whoever granted the share. The API resolves this through a userId parameter no rule form collects, so on its own it currently resolves to nobody.',
  },
  {
    value: 'active_shared_users_except_actor',
    label: 'All shared users except actor',
    parameters: 'none',
    hint: 'Everyone holding an active share on the lead, except whoever made the change.',
  },
  {
    value: 'feature_permission_holders',
    label: 'Feature permission holders',
    parameters: 'permission',
    hint: 'Every active user whose active role holds this permission.',
  },
];

const TRIGGER_LABELS = new Map(TRIGGERS.map((trigger) => [trigger.value, trigger.label]));
const RESOLVER_LABELS = new Map(RESOLVERS.map((resolver) => [resolver.value, resolver.label]));
const parametersFor = (resolverType: string): ParameterKind =>
  RESOLVERS.find((resolver) => resolver.value === resolverType)?.parameters ?? 'none';

/** Mirrors the server's key rule in `validateRule`; the server 400s otherwise. */
const KEY_PATTERN = /^[a-z][a-z0-9_]{1,62}$/;

/**
 * One recipient row.
 *
 * Every parameter any resolver can take is held here, not just the ones the
 * currently selected resolver reads, so switching a row's type and switching
 * back doesn't silently discard what was already chosen. `recipientBody`
 * decides what actually goes to the API.
 */
type RecipientDraft = {
  resolverType: string;
  assignmentType: string;
  module: string;
  action: string;
};
type RuleDraft = {
  id?: string;
  key: string;
  name: string;
  triggerType: string;
  active: boolean;
  recipients: RecipientDraft[];
};

const emptyRecipient = (): RecipientDraft => ({
  resolverType: 'assignment_holder',
  assignmentType: '',
  module: '',
  action: '',
});
const emptyRule = (): RuleDraft => ({
  key: '',
  name: '',
  triggerType: 'field_edited',
  active: true,
  // A rule with no recipients is rejected server-side, so the editor opens
  // with the one row every rule needs.
  recipients: [emptyRecipient()],
});

export function NotificationRulesPage() {
  usePageChrome('Notification rules', [['notification-rules']]);
  const { can } = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [purging, setPurging] = useState<NotificationRule | null>(null);
  // The draft as it was opened. Compared against, so opening a rule and
  // closing the tab is not reported as unsaved work.
  const [pristine, setPristine] = useState<RuleDraft | null>(null);
  useUnsavedDraft(draft, pristine);
  const openDraft = (next: RuleDraft) => {
    setDraft(next);
    setPristine(next);
  };
  const closeDraft = () => {
    setDraft(null);
    setPristine(null);
  };

  const rules = useQuery({ queryKey: ['notification-rules'], queryFn: notificationsApi.rules });
  const catalog = useQuery({ queryKey: ['permission-catalog'], queryFn: adminApi.catalog });
  const journeys = useQuery({ queryKey: ['journeys'], queryFn: configApi.journeys });
  /**
   * The assignment types a resolver may name.
   *
   * `assignment_type` is configurable free text with no enum anywhere, and the
   * only endpoint that enumerates the values in use is Journey detail — the
   * same source `LeadFormPage` assigns from. A notification rule is
   * organization-wide rather than per-Journey, so this is the union across
   * Journeys instead of one Journey's list.
   */
  const journeyIds = (journeys.data ?? []).map((journey) => journey.id);
  const assignmentTypes = useQuery({
    queryKey: ['assignment-types', journeyIds],
    queryFn: async () => {
      const perJourney = await Promise.all(journeyIds.map((id) => configApi.assignmentTypes(id)));
      return [...new Set(perJourney.flat())].sort();
    },
    enabled: journeys.isSuccess,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['notification-rules'] });
  const save = useMutation({
    mutationFn: () => {
      const current = draft ?? emptyRule();
      const body = {
        name: current.name,
        triggerType: current.triggerType,
        recipients: current.recipients.map(recipientBody),
      };
      /*
       * `scope` is deliberately never sent. The column exists and the API
       * accepts it for `field_edited`, but `NotificationService.evaluate`
       * never reads it, so nothing this form could put there would change who
       * gets notified. Omitting the key also leaves whatever an older client
       * stored untouched — Prisma treats `undefined` as "don't change".
       */
      return current.id
        ? notificationsApi.updateRule(current.id, { ...body, active: current.active })
        : notificationsApi.createRule({ ...body, key: current.key });
    },
    onSuccess: async () => {
      closeDraft();
      await invalidate();
    },
  });
  /**
   * Rules are deactivated, never deleted — there is no DELETE endpoint, and
   * `updateRule` audits an `active: false` write as `deactivate`. The whole
   * rule goes back with it because PUT replaces the recipient list wholesale;
   * sending only the flag would wipe every recipient.
   */
  const activation = useMutation({
    mutationFn: ({ rule, active }: { rule: NotificationRule; active: boolean }) =>
      notificationsApi.updateRule(rule.id, {
        name: rule.name,
        triggerType: rule.triggerType,
        active,
        recipients: orderedRecipients(rule).map((recipient) => ({
          resolverType: recipient.resolverType,
          parameters: recipient.parameters,
        })),
      }),
    onSuccess: invalidate,
  });
  const purge = useMutation({
    mutationFn: (id: string) => adminApi.purgeNotificationRule(id),
    onSuccess: async () => {
      setPurging(null);
      await invalidate();
    },
  });

  const error =
    rules.error ??
    catalog.error ??
    journeys.error ??
    assignmentTypes.error ??
    save.error ??
    activation.error;
  const rows = rules.data?.items ?? [];
  const modules = catalog.data?.modules ?? [];
  const canEdit = can('roles_permissions', 'edit');

  return (
    <PageBody>
      <PageHeader
        title="Notification rules"
        description="Who gets an in-app notification when a Lead event happens. A rule can have several recipient resolvers; their results are combined, so a user matched twice is notified once."
        actions={
          can('roles_permissions', 'create') ? (
            <Button onClick={() => openDraft(emptyRule())}>Create rule</Button>
          ) : undefined
        }
      />
      {error ? <Banner tone="error">{friendlyErrorMessage(error)}</Banner> : null}

      {draft ? (
        <RuleEditor
          draft={draft}
          setDraft={setDraft}
          modules={modules}
          assignmentTypes={assignmentTypes.data ?? []}
          assignmentTypesLoading={journeys.isPending || assignmentTypes.isPending}
          dirty={JSON.stringify(draft) !== JSON.stringify(pristine)}
          save={() => save.mutate()}
          cancel={closeDraft}
          loading={save.isPending}
        />
      ) : null}

      <AdminTable
        loading={rules.isPending}
        headers={[
          'Rule',
          'Trigger',
          'Recipients',
          'State',
          { label: 'Actions', align: 'right' as const },
        ]}
        empty={!rules.isPending && rows.length === 0}
      >
        {rows.map((rule) => (
          <DataRow key={rule.id}>
            <DataCell primary>
              <span className="block">{rule.name}</span>
              <span className="text-xs text-ink-soft">{rule.key}</span>
            </DataCell>
            <DataCell>{TRIGGER_LABELS.get(rule.triggerType) ?? rule.triggerType}</DataCell>
            <DataCell>
              <ol className="list-inside list-decimal">
                {orderedRecipients(rule).map((recipient, index) => (
                  <li key={`${recipient.resolverType}-${index}`}>
                    {recipientSummary(recipient, modules)}
                  </li>
                ))}
              </ol>
            </DataCell>
            <DataCell>{rule.active ? 'Active' : 'Inactive'}</DataCell>
            <DataCell align="right">
              <RowActions>
                {canEdit ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => openDraft(toDraft(rule))}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant={rule.active ? 'danger' : 'ghost'}
                      onClick={() => activation.mutate({ rule, active: !rule.active })}
                    >
                      {rule.active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </>
                ) : null}
                {can('roles_permissions', 'purge') && !rule.active ? (
                  <Button size="sm" variant="danger" onClick={() => setPurging(rule)}>
                    Delete permanently
                  </Button>
                ) : null}
              </RowActions>
            </DataCell>
          </DataRow>
        ))}
      </AdminTable>
      {purging ? (
        <PurgeDialog
          entityLabel="Notification rule"
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

/** The API returns recipients in `sortOrder`; don't depend on that silently. */
function orderedRecipients(rule: NotificationRule): NotificationRuleRecipient[] {
  return [...rule.recipients].sort((left, right) => left.sortOrder - right.sortOrder);
}

function recipientSummary(
  recipient: NotificationRuleRecipient,
  modules: ReadonlyArray<{ module: string; label: string }>,
): string {
  const label = RESOLVER_LABELS.get(recipient.resolverType) ?? recipient.resolverType;
  const parameters = recipient.parameters ?? {};
  const assignmentType = parameters.assignmentType;
  const permissionModule = parameters.module;
  const action = parameters.action;
  if (typeof assignmentType === 'string' && assignmentType) return `${label} — ${assignmentType}`;
  if (typeof permissionModule === 'string' && permissionModule) {
    const moduleLabel =
      modules.find((row) => row.module === permissionModule)?.label ?? permissionModule;
    return `${label} — ${moduleLabel}${typeof action === 'string' && action ? ` · ${action}` : ''}`;
  }
  return label;
}

function toDraft(rule: NotificationRule): RuleDraft {
  return {
    id: rule.id,
    key: rule.key,
    name: rule.name,
    triggerType: rule.triggerType,
    active: rule.active,
    recipients: orderedRecipients(rule).map((recipient) => {
      const parameters = recipient.parameters ?? {};
      return {
        resolverType: recipient.resolverType,
        assignmentType: text(parameters.assignmentType),
        module: text(parameters.module),
        action: text(parameters.action),
      };
    }),
  };
}
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function recipientBody(recipient: RecipientDraft) {
  const kind = parametersFor(recipient.resolverType);
  return {
    resolverType: recipient.resolverType,
    parameters:
      kind === 'assignment'
        ? { assignmentType: recipient.assignmentType }
        : kind === 'permission'
          ? { module: recipient.module, action: recipient.action }
          : {},
  };
}

function recipientComplete(recipient: RecipientDraft): boolean {
  const kind = parametersFor(recipient.resolverType);
  if (kind === 'assignment') return recipient.assignmentType !== '';
  if (kind === 'permission') return recipient.module !== '' && recipient.action !== '';
  return true;
}

/**
 * A stored value the catalog no longer offers still belongs in its Select —
 * dropping it would silently rewrite the rule to something else on the next
 * save.
 */
function withStoredValue(options: readonly string[], value: string): readonly string[] {
  return value && !options.includes(value) ? [value, ...options] : options;
}

function RuleEditor({
  draft,
  setDraft,
  modules,
  assignmentTypes,
  assignmentTypesLoading,
  dirty,
  save,
  cancel,
  loading,
}: {
  draft: RuleDraft;
  setDraft: (draft: RuleDraft) => void;
  modules: ReadonlyArray<{ module: string; label: string; actions: string[] }>;
  assignmentTypes: readonly string[];
  assignmentTypesLoading: boolean;
  dirty: boolean;
  save: () => void;
  cancel: () => void;
  loading: boolean;
}) {
  const update = <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) =>
    setDraft({ ...draft, [key]: value });
  const updateRecipient = (index: number, next: Partial<RecipientDraft>) =>
    setDraft({
      ...draft,
      recipients: draft.recipients.map((recipient, position) =>
        position === index ? { ...recipient, ...next } : recipient,
      ),
    });
  const keyValid = KEY_PATTERN.test(draft.key);
  const recipientsComplete = draft.recipients.every(recipientComplete);

  return (
    <Card className="grid gap-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Key"
          required
          hint="Lowercase letters, numbers and underscores — e.g. lead_reassigned_notice."
          {...(draft.key && !keyValid
            ? { error: 'Start with a letter, then lowercase letters, numbers or underscores.' }
            : {})}
        >
          {({ inputId, describedBy }) => (
            <Input
              id={inputId}
              aria-describedby={describedBy}
              // The key identifies the rule for its lifetime; `updateRule`
              // takes no key at all.
              disabled={Boolean(draft.id)}
              value={draft.key}
              placeholder="lead_reassigned_notice"
              onChange={(event) => update('key', event.target.value)}
            />
          )}
        </Field>
        <Field label="Name" required>
          {({ inputId }) => (
            <Input
              id={inputId}
              value={draft.name}
              onChange={(event) => update('name', event.target.value)}
            />
          )}
        </Field>
        <Field label="Trigger" required>
          {({ inputId }) => (
            <Select
              id={inputId}
              value={draft.triggerType}
              onChange={(event) => update('triggerType', event.target.value)}
            >
              {TRIGGERS.map((trigger) => (
                <option key={trigger.value} value={trigger.value}>
                  {trigger.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <fieldset>
        <div className="mb-2 flex items-center justify-between gap-3 border-b border-line pb-1.5">
          <legend className="font-display text-sm font-bold text-ink">Recipients</legend>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setDraft({ ...draft, recipients: [...draft.recipients, emptyRecipient()] })
            }
          >
            Add recipient
          </Button>
        </div>
        {/*
          Order is presentation only. `evaluate` unions every resolver's users
          into a set before writing notifications, so position changes the
          reading order of the rule, never who receives it or how many times.
        */}
        <p className="mb-2 text-xs text-ink-soft">
          Every resolver on the rule contributes recipients. Someone matched by more than one is
          still notified once.
        </p>
        <div className="space-y-2">
          {draft.recipients.map((recipient, index) => {
            const definition = RESOLVERS.find((row) => row.value === recipient.resolverType);
            const kind = parametersFor(recipient.resolverType);
            const actions = modules.find((row) => row.module === recipient.module)?.actions ?? [];
            return (
              <div
                key={`recipient-${index}`}
                className="rounded-control border border-line bg-paper p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-ink-soft">Recipient {index + 1}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    // Every row's button reads "Remove"; the name says which.
                    aria-label={`Remove recipient ${index + 1}`}
                    // The server rejects a rule with no recipients.
                    disabled={draft.recipients.length === 1}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        recipients: draft.recipients.filter((_, position) => position !== index),
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Resolver"
                    required
                    {...(definition ? { hint: definition.hint } : {})}
                  >
                    {({ inputId, describedBy }) => (
                      <Select
                        id={inputId}
                        aria-describedby={describedBy}
                        value={recipient.resolverType}
                        onChange={(event) =>
                          updateRecipient(index, { resolverType: event.target.value })
                        }
                      >
                        {RESOLVERS.map((resolver) => (
                          <option key={resolver.value} value={resolver.value}>
                            {resolver.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  {kind === 'assignment' ? (
                    <Field
                      label="Assignment type"
                      required
                      {...(assignmentTypes.length === 0 && !assignmentTypesLoading
                        ? { hint: 'No assignment types are in use yet on any Journey.' }
                        : {})}
                    >
                      {({ inputId, describedBy }) => (
                        <Select
                          id={inputId}
                          aria-describedby={describedBy}
                          disabled={assignmentTypesLoading}
                          value={recipient.assignmentType}
                          onChange={(event) =>
                            updateRecipient(index, { assignmentType: event.target.value })
                          }
                        >
                          <option value="">
                            {assignmentTypesLoading ? 'Loading…' : 'Select an assignment type…'}
                          </option>
                          {withStoredValue(assignmentTypes, recipient.assignmentType).map(
                            (assignmentType) => (
                              <option key={assignmentType} value={assignmentType}>
                                {assignmentType}
                              </option>
                            ),
                          )}
                        </Select>
                      )}
                    </Field>
                  ) : null}
                  {kind === 'permission' ? (
                    <>
                      <Field label="Permission module" required>
                        {({ inputId }) => (
                          <Select
                            id={inputId}
                            value={recipient.module}
                            onChange={(event) =>
                              // Actions belong to one module, so the chosen
                              // action can't survive a module change.
                              updateRecipient(index, { module: event.target.value, action: '' })
                            }
                          >
                            <option value="">Select a module…</option>
                            {withStoredValue(
                              modules.map((row) => row.module),
                              recipient.module,
                            ).map((moduleName) => (
                              <option key={moduleName} value={moduleName}>
                                {modules.find((row) => row.module === moduleName)?.label ??
                                  moduleName}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                      <Field label="Permission action" required>
                        {({ inputId }) => (
                          <Select
                            id={inputId}
                            disabled={!recipient.module}
                            value={recipient.action}
                            onChange={(event) =>
                              updateRecipient(index, { action: event.target.value })
                            }
                          >
                            <option value="">
                              {recipient.module ? 'Select an action…' : 'Select a module first'}
                            </option>
                            {withStoredValue(actions, recipient.action).map((action) => (
                              <option key={action} value={action}>
                                {action}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        {recipientsComplete ? null : (
          <p className="mt-2 text-xs text-ink-soft">
            Every recipient needs its parameters chosen before the rule can be saved.
          </p>
        )}
      </fieldset>

      <div className="flex items-center gap-2">
        <Button
          loading={loading}
          disabled={
            !draft.name.trim() ||
            (!draft.id && !keyValid) ||
            !recipientsComplete ||
            // An untouched rule has nothing to save, and saving it anyway
            // would bump its version for no change.
            !dirty
          }
          onClick={save}
        >
          Save rule
        </Button>
        <Button variant="ghost" onClick={cancel}>
          Cancel
        </Button>
        {dirty ? (
          <span className="rounded-pill bg-status-calllater-bg px-2 py-0.5 text-xs font-medium text-status-calllater">
            Unsaved changes
          </span>
        ) : null}
      </div>
    </Card>
  );
}
