import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FollowUpDialog } from '../../components/leads/FollowUpDialog';
import { formatFollowUpDate } from '../../components/leads/status-entry';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Eyebrow } from '../../components/ui/Heading';
import { Skeleton } from '../../components/ui/Skeleton';
import { sellersApi, tasksApi } from '../../lib/api-client';
import { ApiError, friendlyErrorMessage } from '../../lib/api-error';
import { qk } from '../../lib/query-keys';
import type { FollowUp, FollowUpStatus } from '../../types/domain';
import { followUpKeys } from '../follow-ups/follow-up-queries';
import { followUpsKey, isOverdue, splitFollowUps } from './follow-ups';

type TaskAction = 'complete' | 'reopen' | 'reschedule' | 'cancel';

/** How a closed follow-up reads — the engine's task states, not configuration. */
const CLOSED_LABEL: Record<Exclude<FollowUpStatus, 'open'>, string> = {
  done: 'Done',
  cancelled: 'Cancelled',
  rescheduled: 'Rescheduled',
};

/**
 * The lead's follow-ups (ADR-0026, D9): what's still owed first, then what
 * happened to the rest. Scheduling goes through the same `PATCH /leads/:id`
 * a status change uses, with only `followUp` set, so it closes any open one
 * on that process instance exactly as a status change would.
 */
export function FollowUpsPanel({
  leadId,
  items,
  isPending,
  error,
  scheduleContext,
  canEditLead,
  currentUserId,
}: {
  leadId: string;
  items: readonly FollowUp[];
  isPending: boolean;
  error: unknown;
  /** The journey context the page acts in; null hides scheduling. */
  scheduleContext: {
    processInstanceId: string;
    journeyId: string;
    assignmentTypes: string[];
  } | null;
  canEditLead: boolean;
  currentUserId: string | undefined;
}) {
  const qc = useQueryClient();
  const [scheduling, setScheduling] = useState(false);
  const [rescheduling, setRescheduling] = useState<FollowUp | null>(null);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: followUpsKey(leadId) }),
      qc.invalidateQueries({ queryKey: qk.sellerActivity(leadId) }),
      // The Follow-ups page and the sidebar badge.
      qc.invalidateQueries({ queryKey: followUpKeys.all() }),
    ]);

  const update = useMutation({
    mutationFn: (input: {
      task: FollowUp;
      action: TaskAction;
      dueAt?: string;
      note?: string | null;
    }) =>
      tasksApi.update(input.task.id, {
        action: input.action,
        ...(input.dueAt === undefined ? {} : { dueAt: input.dueAt }),
        ...(input.note === undefined ? {} : { note: input.note }),
      }),
    onSuccess: async () => {
      setRescheduling(null);
      await refresh();
    },
  });

  const schedule = useMutation({
    mutationFn: (value: { dueAt: string; note: string | null }) =>
      sellersApi.edit(leadId, {
        leadId,
        ...scheduleContext!,
        followUp: { dueAt: value.dueAt, ...(value.note ? { note: value.note } : {}) },
      }),
    onSuccess: async () => {
      setScheduling(false);
      await refresh();
    },
  });

  // Completing someone else's follow-up needs leads:edit; your own doesn't.
  const canAct = (task: FollowUp) => canEditLead || task.assignedToUserId === currentUserId;
  const { open, history } = splitFollowUps(items);

  if (error) {
    return error instanceof ApiError && error.status === 403 ? (
      <EmptyState
        title="Follow-ups aren’t visible to your role"
        description="You can see this seller, but not the follow-ups scheduled on it."
      />
    ) : (
      <Banner tone="error">{friendlyErrorMessage(error)}</Banner>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">Callbacks promised on this seller.</p>
        {scheduleContext && canEditLead ? (
          <Button size="sm" variant="secondary" onClick={() => setScheduling(true)}>
            Schedule follow-up
          </Button>
        ) : null}
      </div>

      {/* A failed reschedule reports inside its own dialog instead. */}
      {update.error && !rescheduling ? (
        <Banner tone="error">{friendlyErrorMessage(update.error)}</Banner>
      ) : null}

      {isPending ? (
        <div className="flex flex-col gap-3" role="status" aria-label="Loading follow-ups">
          {Array.from({ length: 2 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <Eyebrow as="h3">Open</Eyebrow>
            {open.length === 0 ? (
              <p className="text-sm text-ink-soft">Nothing scheduled.</p>
            ) : (
              <ul aria-label="Open follow-ups" className="flex flex-col gap-2">
                {open.map((task) => (
                  <FollowUpItem key={task.id} task={task}>
                    {canAct(task) ? (
                      <div className="flex shrink-0 gap-1">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={update.isPending}
                          onClick={() => update.mutate({ task, action: 'complete' })}
                        >
                          Done
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={update.isPending}
                          onClick={() => setRescheduling(task)}
                        >
                          Reschedule
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={update.isPending}
                          onClick={() => update.mutate({ task, action: 'cancel' })}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : null}
                  </FollowUpItem>
                ))}
              </ul>
            )}
          </section>

          {history.length > 0 ? (
            <section className="flex flex-col gap-2">
              <Eyebrow as="h3">History</Eyebrow>
              <ul aria-label="Follow-up history" className="flex flex-col gap-2">
                {history.map((task) => (
                  <FollowUpItem key={task.id} task={task}>
                    {/* A rescheduled one lives on as its replacement; only a
                        closed one can be reopened. */}
                    {canAct(task) && task.status !== 'rescheduled' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={update.isPending}
                        onClick={() => update.mutate({ task, action: 'reopen' })}
                      >
                        Reopen
                      </Button>
                    ) : null}
                  </FollowUpItem>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      {scheduling && scheduleContext ? (
        <FollowUpDialog
          title="Schedule follow-up"
          description="Any open follow-up in this journey is closed as rescheduled."
          submitLabel="Schedule"
          pending={schedule.isPending}
          error={schedule.error}
          onSubmit={(value) => schedule.mutate(value)}
          onClose={() => {
            setScheduling(false);
            schedule.reset();
          }}
        />
      ) : null}
      {rescheduling ? (
        <FollowUpDialog
          title="Reschedule follow-up"
          submitLabel="Reschedule"
          initial={{ dueAt: rescheduling.dueDate, note: rescheduling.note }}
          pending={update.isPending}
          error={update.error}
          onSubmit={(value) =>
            update.mutate({
              task: rescheduling,
              action: 'reschedule',
              dueAt: value.dueAt,
              note: value.note,
            })
          }
          onClose={() => {
            setRescheduling(null);
            update.reset();
          }}
        />
      ) : null}
    </div>
  );
}

function FollowUpItem({ task, children }: { task: FollowUp; children?: React.ReactNode }) {
  const overdue = isOverdue(task);
  const context = [task.assignedToName, task.journeyName, task.statusName].filter(Boolean);
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 rounded-control border border-line px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">
          <time dateTime={task.dueDate}>{formatFollowUpDate(task.dueDate)}</time>
          {overdue ? (
            <span className="ml-2 rounded-pill bg-status-lost-bg px-1.5 py-0.5 text-[11px] font-semibold text-status-lost">
              Overdue
            </span>
          ) : null}
          {task.status !== 'open' ? (
            <span className="ml-2 rounded-pill bg-surface-sunken px-1.5 py-0.5 text-[11px] font-semibold text-ink-soft">
              {CLOSED_LABEL[task.status]}
            </span>
          ) : null}
        </p>
        {task.note ? (
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-muted">{task.note}</p>
        ) : null}
        <p className="mt-0.5 text-xs text-ink-soft">
          {context.join(' · ')}
          {task.completedAt && task.status !== 'open'
            ? ` · closed ${formatFollowUpDate(task.completedAt)}${task.completedByName ? ` by ${task.completedByName}` : ''}`
            : null}
        </p>
      </div>
      {children}
    </li>
  );
}
