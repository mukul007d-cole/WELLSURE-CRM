import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Banner } from '../../components/ui/Banner';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { StatusPill } from '../../components/ui/StatusPill';
import { DataCell, DataRow, DataTable } from '../../components/ui/DataTable';
import { sellersApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import { qk } from '../../lib/query-keys';
import type { SellerListRow } from '../../types/domain';

/**
 * Other lead records that look like the same contact.
 *
 * The server has no duplicate concept — phone and email are nullable,
 * unnormalized and non-unique — so this matches on the seller search, which is
 * already scope-filtered server-side. That matters more than precision here: a
 * client-side match over a wider fetch could surface a lead the viewer is not
 * entitled to see.
 *
 * The trade-off is that the search is a substring `contains` across name, phone
 * and email, and only covers active leads. Both are stated in the UI rather
 * than hidden.
 */
export function useRepeatLeads(leadId: string, phone: string | null, email: string | null) {
  const needle = (phone ?? email ?? '').trim();
  return useQuery({
    queryKey: qk.sellerRepeats(leadId, needle),
    queryFn: async () => {
      const result = await sellersApi.list({
        search: needle,
        page: 1,
        pageSize: 25,
        accessMode: 'all',
      });
      return result.rows.filter((row) => row.id !== leadId);
    },
    enabled: needle !== '',
    staleTime: 60_000,
  });
}

export function RepeatLeadTab({
  matches,
  isPending,
  error,
  matchedOn,
}: {
  matches: SellerListRow[];
  isPending: boolean;
  error: unknown;
  /** The phone or email the match was run against — null when neither is set. */
  matchedOn: string | null;
}) {
  if (matchedOn === null) {
    return (
      <EmptyState
        title="Nothing to match on"
        description="This seller has no phone number or email address, so there is no way to look for repeats."
      />
    );
  }
  if (error) return <Banner tone="error">{friendlyErrorMessage(error)}</Banner>;
  if (isPending) {
    return (
      <div className="flex flex-col gap-2" role="status" aria-label="Loading repeat leads">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (matches.length === 0) {
    return (
      <EmptyState
        title="No repeats found"
        description={`No other active seller matches ${matchedOn}.`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-soft">
        {matches.length} other active {matches.length === 1 ? 'seller matches' : 'sellers match'}{' '}
        <span className="font-medium text-ink">{matchedOn}</span>. Matching is a text search across
        name, phone and email, so it can catch near misses — and it does not cover deactivated
        records.
      </p>
      <DataTable
        headers={['Seller', 'Contact', 'Journey', 'Status']}
        caption="Other sellers matching this contact"
        maxHeightClass="max-h-[26rem]"
      >
        {matches.map((row) => {
          const process = row.processInstances?.[0];
          return (
            <DataRow key={row.id}>
              <DataCell primary>
                <Link to={`/sellers/${row.id}`} className="underline-offset-2 hover:underline">
                  {row.name}
                </Link>
              </DataCell>
              <DataCell>{row.phone || row.email || '—'}</DataCell>
              <DataCell>{process?.journeyName ?? '—'}</DataCell>
              <DataCell>
                {process ? (
                  <StatusPill
                    name={process.statusName}
                    outcomeType={process.statusOutcomeType}
                    behaviorType={process.statusBehaviorType}
                  />
                ) : (
                  '—'
                )}
              </DataCell>
            </DataRow>
          );
        })}
      </DataTable>
    </div>
  );
}
