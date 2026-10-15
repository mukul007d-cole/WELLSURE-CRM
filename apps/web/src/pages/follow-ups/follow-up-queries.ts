import { useQuery } from '@tanstack/react-query';
import { tasksApi } from '../../lib/api-client';
import type { FollowUpView } from '../../types/domain';

/**
 * Follow-up query keys, as one prefix chain so a mutation can invalidate the
 * lists and the sidebar badge together with `followUpKeys.all()`.
 *
 * Kept beside the page rather than in `lib/query-keys.ts` for now; they can
 * move there unchanged.
 */
export const followUpKeys = {
  all: () => ['follow-ups'] as const,
  summary: () => ['follow-ups', 'summary'] as const,
  lists: () => ['follow-ups', 'list'] as const,
  list: (view: FollowUpView, page: number) => ['follow-ups', 'list', view, page] as const,
};

/**
 * The caller's open follow-up counts. Refetched on focus: the badge is how
 * someone returning to the tab learns a call has come due.
 */
export function useFollowUpSummary() {
  return useQuery({
    queryKey: followUpKeys.summary(),
    queryFn: () => tasksApi.summary(),
    refetchOnWindowFocus: true,
  });
}
