import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, ButtonLink } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { Dialog } from '../ui/Dialog';
import { Field } from '../ui/Field';
import { Select } from '../ui/Select';
import { Skeleton } from '../ui/Skeleton';
import { configApi, sellersApi } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';
import type { FieldDefinition, Status } from '../../types/domain';
import {
  draftToFieldValue,
  emptyDraft,
  isFillableHere,
  type FieldDraft,
} from './field-drafts';
import { EMPTY_FOLLOW_UP, FollowUpFields, type FollowUpDraft } from './FollowUpFields';
import { RequiredFieldInput } from './RequiredFieldInput';
import {
  fromDateTimeLocal,
  isBlankValue,
  schedulesFollowUp,
  toDateTimeLocal,
  type StatusEntryValues,
} from './status-entry';

/** The lead and the move being made, independent of where it was started. */
export interface StatusChangeSubject {
  leadId: string;
  leadName: string;
  journeyId: string;
  fromStatusName: string;
  toStatus: Status;
}

/**
 * Collects what entering a status asks for (ADR-0026, D7/D9) before the
 * change is saved: a reason, a follow-up, and any required Field still empty
 * on this lead. Opened up front when the destination is configured to need
 * any of these, and again when the server answers that more Fields are
 * missing — in which case `missingFieldIds` is the server's list and wins
 * over what the status configuration suggests.
 *
 * The dialog only collects; the caller saves, so the Board can keep its
 * optimistic move and the Seller List its refetch.
 */
export function StatusChangeDialog({
  subject,
  initial,
  missingFieldIds,
  knownFieldValues,
  onSubmit,
  onCancel,
}: {
  subject: StatusChangeSubject;
  /** What the previous attempt carried, so a re-prompt doesn't lose it. */
  initial?: StatusEntryValues | undefined;
  /** From a server rejection; null means "work it out from the status". */
  missingFieldIds: readonly string[] | null;
  /** The lead's values when the caller already has them (Seller 360). */
  knownFieldValues?: Readonly<Record<string, unknown>> | undefined;
  onSubmit: (entry: StatusEntryValues) => void;
  onCancel: () => void;
}) {
  const { leadId, leadName, journeyId, fromStatusName, toStatus } = subject;
  const reasonOptions = toStatus.reasonOptions ?? [];
  const followUpExpected = schedulesFollowUp(toStatus);
  const carriedValues = initial?.fieldValues ?? {};

  const [reason, setReason] = useState(
    initial?.statusReason && reasonOptions.includes(initial.statusReason)
      ? initial.statusReason
      : '',
  );
  const [followUpOn, setFollowUpOn] = useState(followUpExpected || Boolean(initial?.followUp));
  const [followUp, setFollowUp] = useState<FollowUpDraft>(
    initial?.followUp
      ? { dueAt: toDateTimeLocal(initial.followUp.dueAt), note: initial.followUp.note ?? '' }
      : EMPTY_FOLLOW_UP,
  );
  const [drafts, setDrafts] = useState<Record<string, FieldDraft>>({});
  // Errors stay quiet until the first attempt, so an empty form doesn't
  // open already shouting.
  const [attempted, setAttempted] = useState(false);

  const requiredIds =
    missingFieldIds ?? (toStatus.requiredFields ?? []).map((row) => row.fieldId);

  // Only the required Fields' values are needed, and the API returns a value
  // only for ids explicitly requested. A distinct key under `seller` keeps
  // this from handing the Board's field-less prefetch a different shape.
  const valuesQuery = useQuery({
    queryKey: [...qk.seller(leadId), 'status-entry', requiredIds.join(',')],
    queryFn: () => sellersApi.detail(leadId, { requestedFieldIds: requiredIds }),
    enabled: missingFieldIds === null && !knownFieldValues && requiredIds.length > 0,
    retry: false,
  });
  const values = knownFieldValues ?? valuesQuery.data?.fieldValues;

  // Already-filled requirements need nothing (they are checked on entry
  // only). If the values couldn't be read, ask for nothing rather than risk
  // overwriting a real value — the server names what's missing if anything.
  const promptIds =
    missingFieldIds ??
    (values ? requiredIds.filter((fieldId) => isBlankValue(values[fieldId])) : []);

  const journeyFieldsQuery = useQuery({
    queryKey: ['journey-fields', journeyId],
    queryFn: () => configApi.journeyFields(journeyId),
    enabled: promptIds.length > 0,
    retry: false,
  });
  // The organization catalogue is the fallback for a role that can read
  // Fields but not this journey's field settings.
  const catalogueQuery = useQuery({
    queryKey: qk.fields(),
    queryFn: configApi.fields,
    enabled: promptIds.length > 0 && journeyFieldsQuery.isError,
    retry: false,
  });
  const definitions: readonly FieldDefinition[] =
    journeyFieldsQuery.data ?? catalogueQuery.data ?? [];

  const fieldsLoading =
    (missingFieldIds === null &&
      !knownFieldValues &&
      requiredIds.length > 0 &&
      valuesQuery.isPending) ||
    (promptIds.length > 0 &&
      (journeyFieldsQuery.isPending || (journeyFieldsQuery.isError && catalogueQuery.isPending)));

  const promptFields: FieldDefinition[] = [];
  let unresolvedCount = 0;
  for (const fieldId of promptIds) {
    const field = definitions.find((candidate) => candidate.id === fieldId);
    if (field && isFillableHere(field)) promptFields.push(field);
    else unresolvedCount += 1;
  }

  const draftFor = (field: FieldDefinition): FieldDraft =>
    drafts[field.id] ?? draftFromValue(field, carriedValues[field.id]) ?? emptyDraft(field);

  const fieldResults = promptFields.map((field) => ({
    field,
    result: draftToFieldValue(field, draftFor(field)),
  }));
  const followUpIso = followUpOn ? fromDateTimeLocal(followUp.dueAt) : null;
  const followUpError =
    attempted && followUpOn && followUpIso === null ? 'Choose when to follow up.' : undefined;

  const blocked = fieldsLoading || unresolvedCount > 0;

  function submit() {
    setAttempted(true);
    if (blocked) return;
    if (followUpOn && followUpIso === null) return;
    const fieldValues: Record<string, unknown> = {};
    // Values from an earlier attempt still have to be sent: nothing from a
    // refused change was saved.
    for (const [fieldId, value] of Object.entries(carriedValues)) {
      if (!promptIds.includes(fieldId)) fieldValues[fieldId] = value;
    }
    for (const { field, result } of fieldResults) {
      if ('error' in result) return;
      fieldValues[field.id] = result.value;
    }
    const note = followUp.note.trim();
    onSubmit({
      ...(reason ? { statusReason: reason } : {}),
      ...(followUpOn && followUpIso
        ? { followUp: { dueAt: followUpIso, ...(note ? { note } : {}) } }
        : {}),
      ...(Object.keys(fieldValues).length > 0 ? { fieldValues } : {}),
    });
  }

  return (
    <Dialog
      title={missingFieldIds ? 'That move needs more information first' : `Move to ${toStatus.name}`}
      onClose={onCancel}
      footer={
        <>
          {requiredIds.length > 0 ? (
            <ButtonLink variant="ghost" to={`/sellers/${leadId}/edit`}>
              Open seller form
            </ButtonLink>
          ) : null}
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={blocked}>
            Change status
          </Button>
        </>
      }
    >
      <p>
        {/* Every name here comes straight from configuration or the record. */}
        Moving <strong className="font-medium text-ink">{leadName}</strong> from{' '}
        <strong className="font-medium text-ink">{fromStatusName}</strong> to{' '}
        <strong className="font-medium text-ink">{toStatus.name}</strong>
        {missingFieldIds ? ' needs these filled in first.' : '.'}
      </p>

      <div className="mt-4 flex flex-col gap-4">
        {reasonOptions.length > 0 ? (
          <Field label="Reason">
            {({ inputId, describedBy }) => (
              <Select
                id={inputId}
                aria-describedby={describedBy}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              >
                <option value="">No reason</option>
                {reasonOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        {fieldsLoading ? (
          <div className="flex flex-col gap-2" role="status" aria-label="Loading required fields">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : promptFields.length > 0 || unresolvedCount > 0 ? (
          <section className="flex flex-col gap-3" aria-label="Required fields">
            {promptFields.map((field) => {
              const result = fieldResults.find((row) => row.field.id === field.id)?.result;
              return (
                <RequiredFieldInput
                  key={field.id}
                  field={field}
                  value={draftFor(field)}
                  onChange={(next) => setDrafts((current) => ({ ...current, [field.id]: next }))}
                  error={attempted && result && 'error' in result ? result.error : undefined}
                />
              );
            })}
            {unresolvedCount > 0 ? (
              // A role that can't read or edit the Field gets no label to
              // show, and a raw id would be worse than saying less.
              <p className="rounded-control bg-surface-sunken px-3 py-2">
                {unresolvedCount === 1
                  ? 'A required field can’t be filled in here.'
                  : `${unresolvedCount} required fields can’t be filled in here.`}{' '}
                Fill {unresolvedCount === 1 ? 'it' : 'them'} in on the seller form, then try again.
              </p>
            ) : null}
          </section>
        ) : null}

        {followUpExpected ? (
          <FollowUpFields value={followUp} onChange={setFollowUp} required error={followUpError} />
        ) : (
          <>
            <Checkbox
              id={`status-follow-up-${leadId}`}
              label="Schedule a follow-up"
              checked={followUpOn}
              onChange={(event) => setFollowUpOn(event.target.checked)}
            />
            {followUpOn ? (
              <FollowUpFields value={followUp} onChange={setFollowUp} error={followUpError} />
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  );
}

/** A value carried over from an earlier attempt, back in input form. */
function draftFromValue(field: FieldDefinition, value: unknown): FieldDraft | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'boolean') return value;
  if (field.type === 'datetime' && typeof value === 'string') return toDateTimeLocal(value);
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return undefined;
}
