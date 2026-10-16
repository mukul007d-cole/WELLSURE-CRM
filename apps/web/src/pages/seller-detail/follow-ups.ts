import { useQuery } from '@tanstack/react-query';
import { tasksApi } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';
import type { FollowUp } from '../../types/domain';

/**
 * Under `qk.seller` on purpose: every status change already invalidates the
 * lead's whole prefix, and one carrying a follow-up changes this list.
 */
export const followUpsKey = (leadId: string) => [...qk.seller(leadId), 'follow-ups'] as const;

export function useLeadFollowUps(leadId: string | undefined) {
  return useQuery({
    queryKey: followUpsKey(leadId ?? ''),
    queryFn: () => tasksApi.forLead(leadId!),
    enabled: Boolean(leadId),
    retry: false,
  });
}

/** Still owed and already past its due time. */
export function isOverdue(task: Pick<FollowUp, 'status' | 'dueDate'>, now = Date.now()): boolean {
  return task.status === 'open' && Date.parse(task.dueDate) < now;
}

/** Open first (soonest due first), then the history (most recent first). */
export function splitFollowUps(items: readonly FollowUp[]): {
  open: FollowUp[];
  history: FollowUp[];
} {
  const time = (value: string | null) => (value ? Date.parse(value) : 0);
  return {
    open: items
      .filter((item) => item.status === 'open')
      .sort((left, right) => time(left.dueDate) - time(right.dueDate)),
    history: items
      .filter((item) => item.status !== 'open')
      .sort(
        (left, right) =>
          time(right.completedAt ?? right.dueDate) - time(left.completedAt ?? left.dueDate),
      ),
  };
}
