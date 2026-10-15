import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  classifyStatusEntryRejection,
  ROLE_NOT_ALLOWED_MESSAGE,
  type StatusEntryRejection,
  type StatusEntryValues,
} from '../../components/leads/status-entry';
import { useStatusChangeFlow } from '../../components/leads/useStatusChangeFlow';
import { useStatusChoices } from '../../components/leads/useStatusChoices';
import { sellersApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import { qk } from '../../lib/query-keys';
import type { Seller360ProcessInstance, Seller360Record, Status } from '../../types/domain';
import { MoveStatusMenu } from '../board/MoveStatusMenu';
import { followUpKeys } from '../follow-ups/follow-up-queries';

interface RecordStatusChange {
  toStatus: Status;
  entry?: StatusEntryValues | undefined;
}

/**
 * Change the status of the process instance the record is working in.
 * Same flow as the Board and the Seller List (`useStatusChangeFlow`); the
 * record already holds the lead's Field values, so the dialog doesn't have
 * to fetch them to see which required Fields are still empty.
 */
export function RecordStatusControl({
  seller,
  process,
  statuses,
  knownFieldValues,
}: {
  seller: Seller360Record;
  process: Seller360ProcessInstance;
  statuses: readonly Status[];
  /** Absent when the Field catalogue couldn't be read — the dialog then asks. */
  knownFieldValues?: Readonly<Record<string, unknown>> | undefined;
}) {
  const qc = useQueryClient();
  const chooseStatuses = useStatusChoices();
  const [rejection, setRejection] = useState<StatusEntryRejection | null>(null);

  const targets = chooseStatuses(statuses.filter((status) => status.isActive));

  const mutation = useMutation({
    mutationFn: ({ toStatus, entry }: RecordStatusChange) =>
      sellersApi.edit(seller.id, {
        leadId: seller.id,
        processInstanceId: process.processInstanceId,
        journeyId: process.journeyId,
        assignmentTypes: process.assignments.map((assignment) => assignment.assignmentType),
        statusId: toStatus.id,
        ...entry,
      }),
    onError: (error, variables) => {
      const result = classifyStatusEntryRejection(error);
      if (result.kind === 'missing_fields') {
        flow.promptForFields(variables, variables.entry, result.fieldIds);
        return;
      }
      setRejection(result);
    },
    onSettled: () =>
      Promise.all([
        // The record, its activity and its follow-ups all live under this prefix.
        qc.invalidateQueries({ queryKey: qk.seller(seller.id) }),
        qc.invalidateQueries({ queryKey: qk.sellers() }),
        qc.invalidateQueries({ queryKey: qk.board() }),
        qc.invalidateQueries({ queryKey: qk.dashboard() }),
        qc.invalidateQueries({ queryKey: followUpKeys.all() }),
      ]),
  });

  const flow = useStatusChangeFlow<RecordStatusChange>({
    subject: ({ toStatus }) => ({
      leadId: seller.id,
      leadName: seller.name,
      journeyId: process.journeyId,
      fromStatusName: process.currentStatus.name,
      toStatus,
    }),
    submit: (variables, entry) => mutation.mutate({ ...variables, entry }),
    knownFieldValues,
  });

  return (
    <div className="flex flex-col gap-1.5">
      <MoveStatusMenu
        statuses={targets}
        currentStatusId={process.currentStatus.id}
        label={mutation.isPending ? 'Saving…' : 'Change status'}
        accessibleName={`Change status for ${seller.name}`}
        onSelect={(toStatus) => {
          setRejection(null);
          flow.request({ toStatus });
        }}
      />
      {rejection ? (
        <p role="alert" className="text-xs text-status-lost">
          {rejection.kind === 'role_not_allowed'
            ? ROLE_NOT_ALLOWED_MESSAGE
            : rejection.kind === 'stale_status'
              ? "That status isn't available on this journey any more."
              : rejection.kind === 'other'
                ? friendlyErrorMessage(rejection.error)
                : "You don't have permission to change this seller's status."}
        </p>
      ) : null}
      {flow.dialog}
    </div>
  );
}
