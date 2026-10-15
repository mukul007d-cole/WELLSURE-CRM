import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StatusEntryRejection } from '../../components/leads/status-entry';
import { useStatusChangeFlow } from '../../components/leads/useStatusChangeFlow';
import { useStatusChoices } from '../../components/leads/useStatusChoices';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { configApi } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';
import type { SellerListRow, Status } from '../../types/domain';
import { useSellerStatusChange, type SellerStatusChangeVariables } from './useSellerStatusChange';

type SellerProcess = NonNullable<SellerListRow['processInstances']>[number];

/**
 * A row's status can have been deactivated after the lead entered it — the
 * fetched, active-only status list won't contain it, but the `<select>`
 * still has to show *something* selected. A synthetic entry built from the
 * row's own flattened fields keeps the control honest without inventing a
 * `sortOrder`/`isDefaultOnCreate` the row doesn't carry.
 */
function fallbackStatus(process: SellerProcess): Status {
  return {
    id: process.statusId,
    journeyId: process.journeyId,
    key: process.statusId,
    name: process.statusName,
    outcomeType: process.statusOutcomeType,
    behaviorType: process.statusBehaviorType,
    isActive: false,
    sortOrder: -1,
    isDefaultOnCreate: false,
  };
}

/**
 * Inline status dropdown + Save affordance for one Seller List row — a quick
 * alternative to opening the Board or the full edit form, going through the
 * exact same `editLead` write path both of those already use
 * (`useSellerStatusChange`). Rendered only for a viewer holding `leads:edit`;
 * see `SellerListPage`, which falls back to the read-only `StatusPill`
 * otherwise.
 */
export function SellerStatusCell({
  row,
  process,
  onRejected,
  onMoved,
}: {
  row: SellerListRow;
  process: SellerProcess;
  onRejected: (rejection: StatusEntryRejection, variables: SellerStatusChangeVariables) => void;
  onMoved: (variables: SellerStatusChangeVariables) => void;
}) {
  const statusesQuery = useQuery({
    queryKey: qk.journeyStatuses(process.journeyId),
    queryFn: () => configApi.statuses(process.journeyId),
    staleTime: 300_000,
  });

  const chooseStatuses = useStatusChoices();
  const fetchedStatuses = statusesQuery.data ?? [];
  // Only what this role may choose (ADR-0026 allowed roles) — plus the
  // current status below, which has to stay selectable as the value.
  const activeStatuses = chooseStatuses(fetchedStatuses.filter((status) => status.isActive));
  const currentStatus =
    fetchedStatuses.find((status) => status.id === process.statusId) ?? fallbackStatus(process);
  const options = activeStatuses.some((status) => status.id === currentStatus.id)
    ? activeStatuses
    : [currentStatus, ...activeStatuses];

  // Derived during render rather than an effect (the same idiom
  // SellerListPage already uses for its own search/filter drafts): a
  // successful save, or someone else's change arriving on refetch, moves the
  // real status out from under a stale draft, and resyncing from an effect
  // is the exact `useEffect`-plus-`setState` shape this codebase's lint
  // config rejects.
  const [syncedStatusId, setSyncedStatusId] = useState(process.statusId);
  const [pendingStatusId, setPendingStatusId] = useState(process.statusId);
  if (process.statusId !== syncedStatusId) {
    setSyncedStatusId(process.statusId);
    setPendingStatusId(process.statusId);
  }

  const flow = useStatusChangeFlow<SellerStatusChangeVariables>({
    subject: (variables) => ({
      leadId: variables.row.id,
      leadName: variables.row.name,
      journeyId: variables.journeyId,
      fromStatusName: variables.fromStatus.name,
      toStatus: variables.toStatus,
    }),
    submit: (variables, entry) => mutation.mutate({ ...variables, entry }),
    // Cancelling means "don't change it", so stop offering to save.
    onCancel: () => setPendingStatusId(process.statusId),
  });

  const mutation = useSellerStatusChange({
    onRejected: (result, variables) => {
      // Nothing was patched optimistically, so there's nothing to revert —
      // just stop offering to save the attempted value.
      setPendingStatusId(process.statusId);
      // Missing Fields re-open the dialog to collect them; the page reports
      // every outcome (including that one) to assistive tech.
      if (result.kind === 'missing_fields') {
        flow.promptForFields(variables, variables.entry, result.fieldIds);
      }
      onRejected(result, variables);
    },
    onMoved: (variables) => onMoved(variables),
  });

  const dirty = pendingStatusId !== process.statusId;

  function handleSave() {
    const toStatus = options.find((status) => status.id === pendingStatusId);
    if (!toStatus) return;
    flow.request({
      row,
      processInstanceId: process.processInstanceId,
      journeyId: process.journeyId,
      fromStatus: currentStatus,
      toStatus,
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={`seller-status-${row.id}`} className="sr-only">
        Status for {row.name}
      </label>
      <div className="w-36">
        <Select
          id={`seller-status-${row.id}`}
          value={pendingStatusId}
          disabled={mutation.isPending}
          // The row itself navigates on click; stopping it here (rather than
          // on a non-interactive wrapper) keeps the guard on the actual
          // interactive element, same as the Edit link's own guard.
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setPendingStatusId(event.target.value)}
        >
          {options.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </Select>
      </div>
      {dirty ? (
        <Button
          size="sm"
          variant="secondary"
          loading={mutation.isPending}
          onClick={(event) => {
            event.stopPropagation();
            handleSave();
          }}
        >
          Save
        </Button>
      ) : null}

      {flow.dialog ? (
        // The dialog sits inside a clickable table row; without this, every
        // click in it would bubble up and open the seller instead.
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div onClick={(event) => event.stopPropagation()}>{flow.dialog}</div>
      ) : null}
    </div>
  );
}
