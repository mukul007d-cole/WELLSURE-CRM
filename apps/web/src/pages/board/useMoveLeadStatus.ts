import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { sellersApi } from '../../lib/api-client';
import { ApiError } from '../../lib/api-error';
import { qk } from '../../lib/query-keys';
import type { SellerListResponse, SellerListRow, Status } from '../../types/domain';
import { insertRowAtHead, patchRowStatus, removeRow, type ColumnData } from './board-cache';

export interface MoveVariables {
  row: SellerListRow;
  processInstanceId: string;
  journeyId: string;
  fromStatus: Status;
  toStatus: Status;
}

interface MoveContext {
  fromKey: readonly unknown[];
  toKey: readonly unknown[];
  previousFrom: ColumnData;
  previousTo: ColumnData;
}

/** Why a move was refused, in terms the board can act on. */
export type MoveRejection =
  | { kind: 'missing_field'; fieldId: string; variables: MoveVariables }
  | { kind: 'forbidden' }
  | { kind: 'stale_status' }
  | { kind: 'other'; error: unknown };

function classify(error: unknown, variables: MoveVariables): MoveRejection {
  if (!(error instanceof ApiError)) return { kind: 'other', error };

  if (error.status === 403) return { kind: 'forbidden' };

  if (error.status === 400 && error.code === 'validation_error') {
    // The API reports the *first* field that's required at the destination and
    // still empty. We key off details.fieldId rather than the status code,
    // because "status isn't valid on this journey" is also a 400 — but carries
    // no details.
    const fieldId = error.details?.['fieldId'];
    if (typeof fieldId === 'string') return { kind: 'missing_field', fieldId, variables };
    return { kind: 'stale_status' };
  }

  return { kind: 'other', error };
}

export function useMoveLeadStatus(options: {
  onRejected: (rejection: MoveRejection) => void;
  onMoved: (variables: MoveVariables) => void;
}) {
  const queryClient = useQueryClient();

  return useMutation<unknown, unknown, MoveVariables, MoveContext>({
    mutationFn: async ({ row, processInstanceId, journeyId, toStatus }) => {
      /*
       * assignmentTypes feeds the authorization record-predicate server-side:
       * for anything narrower than ORGANIZATION scope, an empty array fails the
       * check outright. List rows don't carry it, so read it off the lead
       * detail — prefetched on drag start, so this is normally a cache hit.
       */
      const detail = await queryClient.ensureQueryData({
        queryKey: qk.seller(row.id),
        queryFn: () => sellersApi.detail(row.id),
      });
      const target =
        detail.processInstances.find(
          (process) => process.processInstanceId === processInstanceId,
        ) ?? detail.processInstances[0];
      const assignmentTypes = [
        ...new Set((target?.assignments ?? []).map((assignment) => assignment.assignmentType)),
      ];

      // No fieldValues key: this is purely a status move, so requestedEditFieldIds
      // stays empty and the server's required-field check is what we surface.
      return sellersApi.edit(row.id, {
        leadId: row.id,
        processInstanceId,
        journeyId,
        statusId: toStatus.id,
        assignmentTypes,
      });
    },

    onMutate: async (variables) => {
      const { row, processInstanceId, journeyId, fromStatus, toStatus } = variables;
      const fromKey = qk.boardColumn(journeyId, fromStatus.id);
      const toKey = qk.boardColumn(journeyId, toStatus.id);

      await Promise.all([
        queryClient.cancelQueries({ queryKey: fromKey }),
        queryClient.cancelQueries({ queryKey: toKey }),
      ]);

      const previousFrom = queryClient.getQueryData<InfiniteData<SellerListResponse>>(fromKey);
      const previousTo = queryClient.getQueryData<InfiniteData<SellerListResponse>>(toKey);

      queryClient.setQueryData<InfiniteData<SellerListResponse>>(fromKey, (old) =>
        removeRow(old, row.id),
      );
      // Only patch a destination that has actually been fetched. Seeding an
      // untouched column would make its first real load look like a correction.
      queryClient.setQueryData<InfiniteData<SellerListResponse>>(toKey, (old) =>
        old ? insertRowAtHead(old, patchRowStatus(row, processInstanceId, toStatus)) : old,
      );

      return { fromKey, toKey, previousFrom, previousTo };
    },

    onError: (error, variables, context) => {
      /*
       * Restoring both snapshots wholesale reverts the rows *and* the totals in
       * one step — no inverse arithmetic to get wrong, and no drift if the same
       * card was moved twice in quick succession.
       */
      if (context) {
        if (context.previousFrom !== undefined) {
          queryClient.setQueryData(context.fromKey, context.previousFrom);
        } else {
          queryClient.removeQueries({ queryKey: context.fromKey, exact: true });
        }
        if (context.previousTo !== undefined) {
          queryClient.setQueryData(context.toKey, context.previousTo);
        } else {
          queryClient.removeQueries({ queryKey: context.toKey, exact: true });
        }
      }

      const rejection = classify(error, variables);
      if (rejection.kind === 'stale_status') {
        void queryClient.invalidateQueries({ queryKey: qk.journeyStatuses(variables.journeyId) });
      }
      if (rejection.kind === 'other') {
        void queryClient.invalidateQueries({ queryKey: qk.board() });
      }
      options.onRejected(rejection);
    },

    onSuccess: (_data, variables) => options.onMoved(variables),

    onSettled: (_data, _error, variables, context) => {
      if (context) {
        void queryClient.invalidateQueries({ queryKey: context.fromKey });
        void queryClient.invalidateQueries({ queryKey: context.toKey });
      }
      void queryClient.invalidateQueries({ queryKey: qk.seller(variables.row.id) });
      // Inactive elsewhere, so these are only marked stale for their next visit.
      void queryClient.invalidateQueries({ queryKey: qk.sellers() });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard() });
    },
  });
}
