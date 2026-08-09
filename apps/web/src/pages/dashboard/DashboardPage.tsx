import { useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { usePageChrome } from '../../app/page-chrome';
import { JourneyTabs } from '../../components/journeys/JourneyTabs';
import { Banner } from '../../components/ui/Banner';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { configApi, sellersApi } from '../../lib/api-client';
import { ApiError, friendlyErrorMessage } from '../../lib/api-error';
import { MAX_CHARTED_STATUSES } from '../../lib/constants';
import { qk } from '../../lib/query-keys';
import { NotificationsPanel, RecentlyUpdatedPanel } from './RecentlyUpdatedPanel';
import { StatusDistributionChart, type StatusCount } from './StatusDistributionChart';
import { PageBody, PageHeader } from '../../components/layout/PageFrame';

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | undefined;
  hint: string;
}) {
  return (
    <Card className="p-5">
      <p className="text-sm text-ink-soft">{label}</p>
      {value === undefined ? (
        <Skeleton className="mt-2 h-8 w-20" />
      ) : (
        <p className="mt-1 font-display text-3xl font-bold tabular-nums text-ink">
          {value.toLocaleString('en-IN')}
        </p>
      )}
      <p className="mt-1 text-xs text-ink-soft">{hint}</p>
    </Card>
  );
}

export function DashboardPage() {
  const [journeyId, setJourneyId] = useState<string | undefined>(undefined);

  usePageChrome('Dashboard', [qk.dashboard(), qk.journeys(), qk.notifications()]);

  const journeysQuery = useQuery({ queryKey: qk.journeys(), queryFn: configApi.journeys });

  const statusesQuery = useQuery({
    queryKey: qk.journeyStatuses(journeyId as string),
    queryFn: () => configApi.statuses(journeyId as string),
    enabled: Boolean(journeyId),
    staleTime: 300_000,
  });

  /**
   * The scope total is its own request rather than a sum of the per-status
   * counts: a lead can hold more than one process instance, so those totals
   * legitimately overlap and would double-count.
   */
  const totalQuery = useQuery({
    queryKey: qk.dashboardTotal(journeyId),
    queryFn: () =>
      sellersApi
        .list({ ...(journeyId ? { journeyId } : {}), page: 1, pageSize: 1, accessMode: 'all' })
        .then((response) => response.total),
    staleTime: 60_000,
  });

  const activeStatuses = (statusesQuery.data ?? [])
    .filter((status) => status.isActive)
    .slice(0, MAX_CHARTED_STATUSES);
  const truncated =
    (statusesQuery.data ?? []).filter((s) => s.isActive).length > activeStatuses.length;

  /**
   * One `pageSize: 1` request per status, read off `total`. This reuses the
   * server's scoped count predicate, so the numbers respect each viewer's data
   * scope automatically — counting fetched rows client-side would be both
   * wrong and a scope leak.
   */
  const countQueries = useQueries({
    queries: activeStatuses.map((status) => ({
      queryKey: qk.dashboardCount(journeyId as string, status.id),
      queryFn: () =>
        sellersApi
          .list({
            journeyId,
            statusId: status.id,
            page: 1,
            pageSize: 1,
            accessMode: 'all',
          })
          .then((response) => response.total),
      staleTime: 60_000,
    })),
  });

  const rows: StatusCount[] = activeStatuses.map((status, index) => ({
    status,
    count: countQueries[index]?.data,
  }));

  const outcomeTotal = (outcome: string) =>
    rows
      .filter((row) => row.status.outcomeType === outcome)
      .reduce<number | undefined>(
        (sum, row) => (sum === undefined || row.count === undefined ? undefined : sum + row.count),
        0,
      );

  // Journeys and statuses sit behind journeys_statuses:view, which a
  // leads-only role may not hold. Say so plainly instead of spinning forever.
  const configForbidden =
    (journeysQuery.error instanceof ApiError && journeysQuery.error.status === 403) ||
    (statusesQuery.error instanceof ApiError && statusesQuery.error.status === 403);

  return (
    <PageBody>
      <PageHeader
        title="Dashboard"
        description="Where your sellers stand right now, within the data you can see."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Sellers in your view"
          value={totalQuery.data}
          hint={journeyId ? 'In the selected journey' : 'Across all journeys'}
        />
        <SummaryCard
          label="Open"
          value={journeyId ? outcomeTotal('open') : undefined}
          hint={journeyId ? 'Still in progress' : 'Pick a journey to break this down'}
        />
        <SummaryCard
          label="Won"
          value={journeyId ? outcomeTotal('closed_won') : undefined}
          hint={journeyId ? 'Closed won' : 'Pick a journey to break this down'}
        />
      </div>

      {totalQuery.isError && !configForbidden ? (
        <Banner tone="error">{friendlyErrorMessage(totalQuery.error)}</Banner>
      ) : null}

      <Card className="overflow-hidden">
        <div className="border-b border-line">
          <JourneyTabs
            journeys={journeysQuery.data ?? []}
            activeJourneyId={journeyId}
            onSelect={setJourneyId}
          />
        </div>
        <div className="p-5">
          {configForbidden ? (
            <EmptyState
              title="Journey configuration isn't visible to your role"
              description="Your role can see sellers but not the journeys and statuses this breakdown is built from. An administrator can grant journey and status visibility."
            />
          ) : !journeyId ? (
            <p className="text-sm text-ink-soft">
              Pick a journey to see how its sellers are distributed across statuses.
            </p>
          ) : statusesQuery.isError ? (
            <Banner tone="error">{friendlyErrorMessage(statusesQuery.error)}</Banner>
          ) : statusesQuery.isPending ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-6 w-full" />
              ))}
            </div>
          ) : activeStatuses.length === 0 ? (
            <EmptyState
              title="This journey has no active statuses"
              description="Add statuses to this journey to see a distribution here."
            />
          ) : (
            <>
              <StatusDistributionChart rows={rows} />
              {truncated ? (
                <p className="mt-4 text-xs text-ink-soft">
                  Showing the first {MAX_CHARTED_STATUSES} statuses by order.
                </p>
              ) : null}
            </>
          )}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <RecentlyUpdatedPanel journeyId={journeyId} />
        <NotificationsPanel />
      </div>
      {/*
        No "my open tasks" card: there is no tasks endpoint in apps/api. A Task
        table exists in the schema and docs/api/endpoints.md documents GET
        /tasks, but nothing implements it, so there is nothing honest to show.
      */}
    </PageBody>
  );
}
