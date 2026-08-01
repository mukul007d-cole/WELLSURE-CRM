import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { configApi, sellersApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import { DEFAULT_PAGE_SIZE } from '../../lib/constants';
import { Banner } from '../../components/ui/Banner';
import { Button, ButtonLink } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Input } from '../../components/ui/Input';
import { Pagination } from '../../components/ui/Pagination';
import { RingAvatar } from '../../components/ui/RingAvatar';
import { Select } from '../../components/ui/Select';
import { SellerRowSkeleton } from '../../components/ui/Skeleton';
import { StatusPill } from '../../components/ui/StatusPill';
import { JourneyTabs } from './JourneyTabs';

export function SellerListPage() {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const journeyId = params.get('journeyId') ?? undefined;
  const statusId = params.get('statusId') ?? undefined;
  const search = params.get('search') ?? '';
  const page = Number(params.get('page') ?? '1');

  // Derived during render (not an effect) so external changes to `search`
  // (browser back/forward, "Clear filters") sync the draft without an
  // extra render pass — see "You Might Not Need an Effect" in the React docs.
  const [syncedSearch, setSyncedSearch] = useState(search);
  const [searchDraft, setSearchDraft] = useState(search);
  if (search !== syncedSearch) {
    setSyncedSearch(search);
    setSearchDraft(search);
  }

  useEffect(() => {
    if (searchDraft === search) return;
    const handle = setTimeout(() => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (searchDraft) next.set('search', searchDraft);
        else next.delete('search');
        next.set('page', '1');
        return next;
      });
    }, 350);
    return () => clearTimeout(handle);
  }, [searchDraft, search, setParams]);

  const journeysQuery = useQuery({ queryKey: ['journeys'], queryFn: configApi.journeys });
  const statusesQuery = useQuery({
    queryKey: ['statuses', journeyId],
    queryFn: () => configApi.statuses(journeyId as string),
    enabled: Boolean(journeyId),
  });

  const sellersQuery = useQuery({
    queryKey: ['sellers', { journeyId, statusId, search, page }],
    queryFn: () =>
      sellersApi.list({
        journeyId,
        statusId,
        search: search || undefined,
        page,
        pageSize: DEFAULT_PAGE_SIZE,
        sortBy: 'updatedAt',
        sortDirection: 'desc',
      }),
    placeholderData: (previous) => previous,
  });

  function updateParam(key: string, value: string | undefined) {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.set('page', '1');
      return next;
    });
  }

  const hasFilters = Boolean(search || statusId);
  const rows = sellersQuery.data?.rows ?? [];

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-4 border-b border-line bg-surface px-4 py-5 sm:px-6">
        {(location.state as { forbiddenFrom?: string } | null)?.forbiddenFrom ? (
          <Banner tone="error">You do not have permission to open that administration page.</Banner>
        ) : null}
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-2xl font-bold text-ink">Sellers</h2>
            <p className="mt-0.5 text-sm text-ink-soft">
              Every lead and seller across your journeys, in one place.
            </p>
          </div>
          <ButtonLink to="/sellers/new" className="w-full sm:w-auto">
            New seller
          </ButtonLink>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="sm:max-w-xs sm:flex-1">
            <label htmlFor="seller-search" className="sr-only">
              Search sellers
            </label>
            <Input
              id="seller-search"
              type="search"
              placeholder="Search by name, phone, or email"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
            />
          </div>
          <div className="sm:w-56">
            <label htmlFor="status-filter" className="sr-only">
              Filter by status
            </label>
            <Select
              id="status-filter"
              value={statusId ?? ''}
              disabled={!journeyId}
              onChange={(event) => updateParam('statusId', event.target.value || undefined)}
            >
              <option value="">{journeyId ? 'All statuses' : 'Select a journey first'}</option>
              {statusesQuery.data?.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      <div className="border-b border-line bg-surface">
        <JourneyTabs
          journeys={journeysQuery.data ?? []}
          activeJourneyId={journeyId}
          onSelect={(id) => {
            updateParam('journeyId', id);
            updateParam('statusId', undefined);
          }}
        />
      </div>

      <div className="bg-surface">
        {sellersQuery.isError ? (
          <div className="p-6">
            <Banner tone="error">{friendlyErrorMessage(sellersQuery.error)}</Banner>
          </div>
        ) : sellersQuery.isPending ? (
          <div>
            {Array.from({ length: 6 }).map((_, index) => (
              <SellerRowSkeleton key={index} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No sellers match your filters' : 'No sellers yet'}
            description={
              hasFilters
                ? 'Try a different search term or clear the status filter to widen your results.'
                : 'Once sellers are added to this journey, they will show up here.'
            }
            action={
              hasFilters ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearchDraft('');
                    setParams(new URLSearchParams());
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <ButtonLink to="/sellers/new">Add your first seller</ButtonLink>
              )
            }
          />
        ) : (
          <>
            {/* Table for sm+ */}
            <table className="hidden w-full text-left sm:table">
              <thead>
                <tr className="border-b border-line text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  <th className="px-6 py-3 font-semibold">Seller</th>
                  <th className="px-4 py-3 font-semibold">Journey</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Owner</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const process = row.processInstances?.[0];
                  return (
                    <tr key={row.id} className="border-b border-line last:border-0 hover:bg-paper">
                      <td className="px-6 py-3">
                        <Link to={`/sellers/${row.id}`} className="flex items-center gap-3">
                          <RingAvatar name={row.name} size={34} />
                          <span>
                            <span className="block text-sm font-medium text-ink">{row.name}</span>
                            <span className="block text-xs text-ink-soft">
                              {row.phone || row.email || '—'}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-ink-soft">
                        {process?.journeyName ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        {process ? (
                          <StatusPill
                            name={process.statusName}
                            outcomeType={process.statusOutcomeType}
                            behaviorType={process.statusBehaviorType}
                          />
                        ) : (
                          <span className="text-sm text-ink-soft">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-ink-soft">
                        {process?.ownerName ?? 'Unassigned'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Cards for mobile */}
            <ul className="divide-y divide-line sm:hidden">
              {rows.map((row) => {
                const process = row.processInstances?.[0];
                return (
                  <li key={row.id}>
                    <Link to={`/sellers/${row.id}`} className="flex items-center gap-3 px-4 py-3">
                      <RingAvatar name={row.name} size={38} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{row.name}</p>
                        <p className="truncate text-xs text-ink-soft">
                          {process?.journeyName ?? '—'} · {process?.ownerName ?? 'Unassigned'}
                        </p>
                      </div>
                      {process ? (
                        <StatusPill
                          name={process.statusName}
                          outcomeType={process.statusOutcomeType}
                          behaviorType={process.statusBehaviorType}
                        />
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>

            <Pagination
              page={page}
              pageSize={DEFAULT_PAGE_SIZE}
              total={sellersQuery.data?.total ?? 0}
              onPageChange={(next) => updateParam('page', String(Math.max(1, next)))}
            />
          </>
        )}
      </div>
    </div>
  );
}
