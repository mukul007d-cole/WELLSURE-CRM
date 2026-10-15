import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { usePageChrome } from '../../app/page-chrome';
import { PageBody, PageHeader } from '../../components/layout/PageFrame';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Pagination } from '../../components/ui/Pagination';
import { Tabs, TabPanel, useTabGroup, type TabItem } from '../../components/ui/Tabs';
import { tasksApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import { cn } from '../../lib/cn';
import type { FollowUp, FollowUpView } from '../../types/domain';
import { absoluteDue, relativeDue } from './due-date';
import { followUpKeys, useFollowUpSummary } from './follow-up-queries';
import {
  FollowUpActionDialog,
  type FollowUpDialogMode,
  type FollowUpUpdate,
} from './FollowUpActionDialog';

const PAGE_SIZE = 25;

const VIEWS: readonly FollowUpView[] = ['overdue', 'today', 'upcoming', 'done'];

const VIEW_COPY: Record<FollowUpView, { label: string; emptyTitle: string; empty: string }> = {
  overdue: {
    label: 'Overdue',
    emptyTitle: 'Nothing overdue',
    empty: 'Every follow-up that has come due is dealt with.',
  },
  today: {
    label: 'Today',
    emptyTitle: 'Nothing else due today',
    empty: 'Follow-ups due later today will appear here.',
  },
  upcoming: {
    label: 'Upcoming',
    emptyTitle: 'Nothing scheduled',
    empty: "Set a follow-up date when you change a seller's status to plan the next call.",
  },
  done: {
    label: 'Done',
    emptyTitle: 'Nothing completed yet',
    empty: 'Follow-ups you mark done appear here, most recent first.',
  },
};

function isView(value: string | null): value is FollowUpView {
  return VIEWS.includes(value as FollowUpView);
}

/**
 * The signed-in user's own follow-ups (D9), one tab per due window.
 *
 * The API decides whose follow-ups these are and drops any on a lead the
 * caller can no longer see; this page only presents what comes back.
 */
export function FollowUpsPage() {
  usePageChrome('Follow-ups', [followUpKeys.all()]);
  const qc = useQueryClient();
  const tabGroup = useTabGroup();
  const [params, setParams] = useSearchParams();
  // In the URL so a link (or the back button) lands on the same tab.
  const view: FollowUpView = isView(params.get('view'))
    ? (params.get('view') as FollowUpView)
    : 'overdue';
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<{ followUp: FollowUp; mode: FollowUpDialogMode } | null>(
    null,
  );

  const summary = useFollowUpSummary();
  const list = useQuery({
    queryKey: followUpKeys.list(view, page),
    queryFn: () => tasksApi.list(view, page, PAGE_SIZE),
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: FollowUpUpdate }) => tasksApi.update(id, body),
    onSuccess: async () => {
      setDialog(null);
      // The item has changed tab, so every list and the counts are stale.
      await qc.invalidateQueries({ queryKey: followUpKeys.all() });
    },
  });

  // Finishing the last item on a later page would otherwise strand the user
  // on an empty page with results still before it. Adjusted during render,
  // not in an effect: the earlier page's query has no data yet, so this
  // settles after one step instead of painting the empty page first.
  if (list.data && !list.data.items.length && page > 1) setPage(page - 1);

  function changeView(next: FollowUpView) {
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        copy.set('view', next);
        return copy;
      },
      { replace: true },
    );
    setPage(1);
  }

  function openDialog(followUp: FollowUp, mode: FollowUpDialogMode) {
    update.reset();
    setDialog({ followUp, mode });
  }

  const tabItems: TabItem<FollowUpView>[] = VIEWS.map((id) => ({
    id,
    label: VIEW_COPY[id].label,
    ...(id !== 'done' && summary.data ? { badge: summary.data[id] } : {}),
  }));
  const copy = VIEW_COPY[view];
  // Errors from a dialog are shown inside it; this catches Reopen and the list.
  const pageError = list.error ?? (dialog ? null : update.error);

  return (
    <PageBody>
      <PageHeader
        title="Follow-ups"
        description="The calls and check-ins you've scheduled, by when they're due."
      />
      {pageError ? <Banner tone="error">{friendlyErrorMessage(pageError)}</Banner> : null}

      <section className="min-w-0 rounded-card border border-line bg-surface shadow-[var(--shadow-card)]">
        <Tabs
          groupId={tabGroup}
          items={tabItems}
          active={view}
          onChange={changeView}
          label="Follow-up views"
        />
        <TabPanel groupId={tabGroup} id={view}>
          {list.data?.truncated ? (
            <div className="border-b border-line p-4">
              <Banner tone="info">
                {view === 'done'
                  ? 'Only your most recently completed follow-ups are listed.'
                  : 'Only your earliest follow-ups in this view are listed. Complete or reschedule some to see the rest.'}
              </Banner>
            </div>
          ) : null}
          {list.isPending ? (
            <p className="p-4 text-sm text-ink-soft" role="status">
              Loading follow-ups…
            </p>
          ) : list.data && !list.data.items.length ? (
            <EmptyState title={copy.emptyTitle} description={copy.empty} />
          ) : (
            <ul className="divide-y divide-line">
              {list.data?.items.map((followUp) => (
                <FollowUpRow
                  key={followUp.id}
                  followUp={followUp}
                  overdue={view === 'overdue'}
                  reopening={update.isPending && update.variables?.id === followUp.id}
                  onAction={(mode) => openDialog(followUp, mode)}
                  onReopen={() => update.mutate({ id: followUp.id, body: { action: 'reopen' } })}
                />
              ))}
            </ul>
          )}
          {list.data && list.data.total > list.data.pageSize ? (
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              onPageChange={setPage}
            />
          ) : null}
        </TabPanel>
      </section>

      {dialog ? (
        <FollowUpActionDialog
          followUp={dialog.followUp}
          mode={dialog.mode}
          pending={update.isPending}
          error={update.error}
          onClose={() => setDialog(null)}
          onConfirm={(body) => update.mutate({ id: dialog.followUp.id, body })}
        />
      ) : null}
    </PageBody>
  );
}

function FollowUpRow({
  followUp,
  overdue,
  reopening,
  onAction,
  onReopen,
}: {
  followUp: FollowUp;
  overdue: boolean;
  reopening: boolean;
  onAction: (mode: FollowUpDialogMode) => void;
  onReopen: () => void;
}) {
  const context = [followUp.journeyName, followUp.statusName].filter(Boolean).join(' · ');
  const done = followUp.status === 'done';
  // Repeated per row, so each button names its lead for assistive tech while
  // the visible label stays short.
  const forLead = <span className="sr-only"> — {followUp.leadName}</span>;

  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <Link
          to={`/sellers/${followUp.leadId}`}
          className="font-medium text-ink underline-offset-2 hover:underline"
        >
          {followUp.leadName}
        </Link>
        {context ? <p className="text-xs text-ink-soft">{context}</p> : null}
        <p className={cn('text-sm', overdue ? 'text-status-lost' : 'text-ink-muted')}>
          Due{' '}
          <time dateTime={followUp.dueDate} className="font-medium">
            {relativeDue(followUp.dueDate)}
          </time>{' '}
          <span className="text-ink-soft">· {absoluteDue(followUp.dueDate)}</span>
        </p>
        {done && followUp.completedAt ? (
          <p className="text-xs text-ink-soft">
            Completed {absoluteDue(followUp.completedAt)}
            {followUp.completedByName ? ` by ${followUp.completedByName}` : ''}
          </p>
        ) : null}
        {followUp.note ? (
          <p className="whitespace-pre-line text-sm text-ink-muted">{followUp.note}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {done ? (
          <Button size="sm" variant="secondary" loading={reopening} onClick={onReopen}>
            Reopen{forLead}
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={() => onAction('complete')}>
              Done{forLead}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onAction('reschedule')}>
              Reschedule{forLead}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onAction('cancel')}>
              Cancel{forLead}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
