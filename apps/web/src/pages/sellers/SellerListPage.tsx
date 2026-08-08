import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
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
import { JourneyTabs } from '../../components/journeys/JourneyTabs';
import { PageHeader, ResultSummary, Toolbar } from '../../components/layout/PageFrame';
import { ViewSwitcher } from '../../components/layout/ViewSwitcher';
import { DataCell, DataRow, DataTable, RowActions } from '../../components/ui/DataTable';
import { usePageChrome } from '../../app/page-chrome';
import { usePreferences } from '../../app/preferences';
import { qk } from '../../lib/query-keys';

export function SellerListPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { tableDensity } = usePreferences();
  usePageChrome('Sellers', [qk.sellers(), qk.journeys()]);
  const [params, setParams] = useSearchParams();
  const journeyId = params.get('journeyId') ?? undefined;
  const statusId = params.get('statusId') ?? undefined;
  const search = params.get('search') ?? '';
  const page = Number(params.get('page') ?? '1');
  const accessMode =
    (params.get('accessMode') as 'mine' | 'shared_with_me' | 'all' | null) ?? 'all';

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
    queryKey: ['sellers', { journeyId, statusId, search, page, accessMode }],
    queryFn: () =>
      sellersApi.list({
        journeyId,
        statusId,
        search: search || undefined,
        page,
        pageSize: DEFAULT_PAGE_SIZE,
        sortBy: 'updatedAt',
        sortDirection: 'desc',
        accessMode,
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
  const total = sellersQuery.data?.total ?? 0;

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-4 border-b border-line bg-surface px-4 py-5 sm:px-6">
        {(location.state as { forbiddenFrom?: string } | null)?.forbiddenFrom ? (
          <Banner tone="error">You do not have permission to open that administration page.</Banner>
        ) : null}
        <PageHeader
          title="Sellers"
          description="Every lead and seller across your journeys, in one place."
          actions={
            <>
              <ViewSwitcher
                views={[
                  { label: 'Table', to: '/sellers', icon: 'table' },
                  { label: 'Board', to: '/sellers/board', icon: 'board' },
                ]}
              />
              <ButtonLink to="/sellers/new">New seller</ButtonLink>
            </>
          }
        />

        <Toolbar
          trailing={
            <ResultSummary>
              {sellersQuery.isPending
                ? 'Loading…'
                : `${total.toLocaleString('en-IN')} ${total === 1 ? 'seller' : 'sellers'}${
                    hasFilters ? ' matching' : ''
                  }`}
            </ResultSummary>
          }
        >
          <div className="w-full sm:w-44">
            <label htmlFor="access-filter" className="sr-only">
              Lead access
            </label>
            <Select
              id="access-filter"
              value={accessMode}
              onChange={(e) => updateParam('accessMode', e.target.value)}
            >
              <option value="mine">My leads</option>
              <option value="shared_with_me">Shared with me</option>
              <option value="all">All</option>
            </Select>
          </div>
          <div className="w-full sm:max-w-xs sm:flex-1">
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
          <div className="w-full sm:w-52">
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
          {hasFilters ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchDraft('');
                setParams(new URLSearchParams());
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </Toolbar>
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
            <div className="hidden sm:block">
              <DataTable
                caption="Sellers"
                density={tableDensity}
                headers={['Seller', 'Journey', 'Status', 'Owner', { label: '', width: '5rem' }]}
              >
                {rows.map((row) => {
                  const process = row.processInstances?.[0];
                  return (
                    <DataRow key={row.id} onClick={() => void navigate(`/sellers/${row.id}`)}>
                      <DataCell primary>
                        <span className="flex items-center gap-3">
                          <RingAvatar name={row.name} size={32} />
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium text-ink">
                                {row.name}
                              </span>
                              {row.shared ? (
                                <span className="rounded-pill bg-status-followup-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-status-followup">
                                  Shared
                                </span>
                              ) : null}
                            </span>
                            <span className="block truncate text-xs text-ink-soft">
                              {row.phone || row.email || '—'}
                            </span>
                          </span>
                        </span>
                      </DataCell>
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
                      <DataCell>{process?.ownerName ?? 'Unassigned'}</DataCell>
                      <DataCell align="right">
                        <RowActions>
                          <Link
                            to={`/sellers/${row.id}/edit`}
                            onClick={(event) => event.stopPropagation()}
                            className="rounded-control px-2 py-1 text-xs font-medium text-ink-soft hover:bg-paper hover:text-ink"
                          >
                            Edit
                          </Link>
                        </RowActions>
                      </DataCell>
                    </DataRow>
                  );
                })}
              </DataTable>
            </div>

            {/* Cards for mobile */}
            <ul className="divide-y divide-line sm:hidden">
              {rows.map((row) => {
                const process = row.processInstances?.[0];
                return (
                  <li key={row.id}>
                    <Link to={`/sellers/${row.id}`} className="flex items-center gap-3 px-4 py-3">
                      <RingAvatar name={row.name} size={38} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">
                          {row.name}{' '}
                          {row.shared ? (
                            <span className="rounded-pill bg-status-followup-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-status-followup">
                              Shared
                            </span>
                          ) : null}
                        </p>
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
