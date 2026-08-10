import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { configApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import { qk } from '../../lib/query-keys';
import type { Seller360ProcessInstance } from '../../types/domain';

export type JourneyAction = 'move' | 'add';

const COPY: Record<JourneyAction, { title: string; submit: string; busy: string; blurb: string }> =
  {
    move: {
      title: 'Move to another journey',
      submit: 'Move',
      busy: 'Moving…',
      blurb:
        'The seller leaves its current journey and picks up the destination’s statuses. Assignments and field values travel with it.',
    },
    add: {
      title: 'Add to another journey',
      submit: 'Add',
      busy: 'Adding…',
      blurb:
        'The seller stays where it is and also joins the destination journey. Both memberships share one set of field values.',
    },
  };

/**
 * Move or add, in one dialog.
 *
 * They differ only in what happens to the current membership, so splitting
 * them into two components would duplicate the journey and status pickers and
 * the required-field error handling for no gain.
 */
export function JourneyDialog({
  action,
  processes,
  onClose,
  onSubmit,
  pending,
  error,
}: {
  action: JourneyAction;
  processes: Seller360ProcessInstance[];
  onClose: () => void;
  onSubmit: (input: {
    processInstanceId: string;
    targetJourneyId: string;
    statusId: string | undefined;
  }) => void;
  pending: boolean;
  error: unknown;
}) {
  const copy = COPY[action];
  const [processInstanceId, setProcessInstanceId] = useState(processes[0]?.processInstanceId ?? '');
  const [targetJourneyId, setTargetJourneyId] = useState('');
  const [statusId, setStatusId] = useState('');

  const journeysQuery = useQuery({ queryKey: qk.journeys(), queryFn: configApi.journeys });
  const statusesQuery = useQuery({
    queryKey: qk.journeyStatuses(targetJourneyId),
    queryFn: () => configApi.statuses(targetJourneyId),
    enabled: targetJourneyId !== '',
  });

  // A lead can hold only one active membership per journey, so anywhere it
  // already lives is not a destination.
  const occupied = new Set(processes.map((row) => row.journeyId));
  const destinations = (journeysQuery.data ?? []).filter(
    (journey) => journey.isActive && !occupied.has(journey.id),
  );

  return (
    <Dialog
      title={copy.title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!targetJourneyId || pending}
            onClick={() =>
              onSubmit({
                processInstanceId,
                targetJourneyId,
                statusId: statusId || undefined,
              })
            }
          >
            {pending ? copy.busy : copy.submit}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">{copy.blurb}</p>

        {processes.length > 1 ? (
          <Field label={action === 'move' ? 'Journey to move from' : 'Journey to copy from'}>
            {({ inputId }) => (
              <Select
                id={inputId}
                value={processInstanceId}
                onChange={(event) => setProcessInstanceId(event.target.value)}
              >
                {processes.map((process) => (
                  <option key={process.processInstanceId} value={process.processInstanceId}>
                    {process.journey.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        {destinations.length === 0 ? (
          <Banner tone="info">
            This seller is already in every active journey, so there is nowhere to{' '}
            {action === 'move' ? 'move' : 'add'} it.
          </Banner>
        ) : (
          <Field label="Destination journey" required>
            {({ inputId }) => (
              <Select
                id={inputId}
                value={targetJourneyId}
                onChange={(event) => {
                  setTargetJourneyId(event.target.value);
                  // Statuses belong to a journey; a stale one would be invalid.
                  setStatusId('');
                }}
              >
                <option value="">Choose a journey…</option>
                {destinations.map((journey) => (
                  <option key={journey.id} value={journey.id}>
                    {journey.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        {targetJourneyId ? (
          <Field
            label="Starting status"
            hint="Leave unset to use the destination journey's default."
          >
            {({ inputId }) => (
              <Select
                id={inputId}
                value={statusId}
                onChange={(event) => setStatusId(event.target.value)}
              >
                <option value="">Journey default</option>
                {(statusesQuery.data ?? []).map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        {error ? <Banner tone="error">{friendlyErrorMessage(error)}</Banner> : null}
      </div>
    </Dialog>
  );
}
