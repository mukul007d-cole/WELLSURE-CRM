import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sellersApi } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';
import {
  classifyStatusChangeRejection,
  type StatusChangeRejection,
  type StatusChangeVariables,
} from '../../lib/status-change';

/**
 * The Seller List's own status-change mutation — same write path and error
 * classification as the Board's `useMoveLeadStatus`, deliberately without its
 * optimistic column-cache patch. The Seller List's query is one arbitrarily
 * filtered/sorted/paginated page, not two known columns: a status change can
 * move a row out of the current view, or (per ADR-0020/0021) a routing
 * reassignment can change who is even allowed to see it, computed fresh
 * server-side on every request. A real re-fetch is the only thing correct
 * for both at once, so `onSettled` invalidates rather than patches.
 */
export function useSellerStatusChange(options: {
  onRejected: (rejection: StatusChangeRejection) => void;
  onMoved: (variables: StatusChangeVariables) => void;
}) {
  const queryClient = useQueryClient();

  return useMutation<unknown, unknown, StatusChangeVariables>({
    mutationFn: async ({ row, processInstanceId, journeyId, toStatus }) => {
      // Same assignmentTypes lookup useMoveLeadStatus relies on: list rows
      // don't carry it, and it's load-bearing for the authorization
      // record-predicate on any scope narrower than ORGANIZATION.
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

      // No fieldValues key: this is purely a status change, so the server's
      // required-field check is what comes back on rejection.
      return sellersApi.edit(row.id, {
        leadId: row.id,
        processInstanceId,
        journeyId,
        statusId: toStatus.id,
        assignmentTypes,
      });
    },

    onError: (error, variables) => {
      options.onRejected(classifyStatusChangeRejection(error, variables));
    },

    onSuccess: (_data, variables) => options.onMoved(variables),

    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: qk.sellers() });
      void queryClient.invalidateQueries({ queryKey: qk.seller(variables.row.id) });
      // Inactive elsewhere, so this is only marked stale for its next visit.
      void queryClient.invalidateQueries({ queryKey: qk.dashboard() });
    },
  });
}
