import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Banner } from '../../components/ui/Banner';
import { Card } from '../../components/ui/Card';
import { RingAvatar } from '../../components/ui/RingAvatar';
import { Skeleton } from '../../components/ui/Skeleton';
import { StatusPill } from '../../components/ui/StatusPill';
import { notificationsApi, sellersApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import { DASHBOARD_RECENT_SIZE } from '../../lib/constants';
import { qk } from '../../lib/query-keys';
import { formatRelativeDate } from '../../lib/format';

function PanelShell({
  title,
  caption,
  children,
}: {
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <h3 className="font-display text-base font-bold text-ink">{title}</h3>
      <p className="mt-0.5 text-xs text-ink-soft">{caption}</p>
      <div className="mt-4">{children}</div>
    </Card>
  );
}

export function RecentlyUpdatedPanel({ journeyId }: { journeyId: string | undefined }) {
  const recent = useQuery({
    queryKey: qk.dashboardRecent(journeyId),
    queryFn: () =>
      sellersApi.list({
        ...(journeyId ? { journeyId } : {}),
        page: 1,
        pageSize: DASHBOARD_RECENT_SIZE,
        sortBy: 'updatedAt',
        sortDirection: 'desc',
        accessMode: 'all',
      }),
  });

  return (
    <PanelShell
      title="Recently updated"
      // Deliberately not called "activity": activity_logs is written server-side
      // but exposed on no endpoint, so this is the most-recently-changed sellers
      // in your scope, not an audit trail.
      caption="Sellers you can see that changed most recently. There's no activity-log API yet."
    >
      {recent.isError ? (
        <Banner tone="error">{friendlyErrorMessage(recent.error)}</Banner>
      ) : recent.isPending ? (
        <ul className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <li key={index} className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 flex-1" />
            </li>
          ))}
        </ul>
      ) : recent.data.rows.length === 0 ? (
        <p className="text-sm text-ink-soft">Nothing has changed yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {recent.data.rows.map((row) => {
            const process = row.processInstances?.[0];
            return (
              <li key={row.id}>
                <Link
                  to={`/sellers/${row.id}`}
                  className="flex items-center gap-3 py-2.5 hover:bg-paper"
                >
                  <RingAvatar name={row.name} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{row.name}</span>
                    {process ? (
                      <span className="block truncate text-xs text-ink-soft">
                        {process.journeyName}
                      </span>
                    ) : null}
                  </span>
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
      )}
    </PanelShell>
  );
}

export function NotificationsPanel() {
  const notifications = useQuery({
    queryKey: qk.notifications(),
    queryFn: () => notificationsApi.list(1),
  });

  return (
    <PanelShell title="Your notifications" caption="The most recent alerts addressed to you.">
      {notifications.isError ? (
        <Banner tone="error">{friendlyErrorMessage(notifications.error)}</Banner>
      ) : notifications.isPending ? (
        <ul className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <li key={index}>
              <Skeleton className="h-4 w-full" />
            </li>
          ))}
        </ul>
      ) : notifications.data.items.length === 0 ? (
        <p className="text-sm text-ink-soft">No notifications yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {notifications.data.items.slice(0, 5).map((item) => (
            <li key={item.id} className="py-2.5">
              {item.referenceLeadId ? (
                <Link
                  to={`/sellers/${item.referenceLeadId}`}
                  className="block text-sm text-ink hover:underline"
                >
                  {item.message}
                </Link>
              ) : (
                <p className="text-sm text-ink">{item.message}</p>
              )}
              <p className="mt-0.5 text-xs text-ink-soft">{formatRelativeDate(item.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}
