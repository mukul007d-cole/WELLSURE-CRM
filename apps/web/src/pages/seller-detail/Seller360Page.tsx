import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../../app/AuthContext';
import { usePageChrome } from '../../app/page-chrome';
import { configApi, sellersApi } from '../../lib/api-client';
import { ApiError, friendlyErrorMessage } from '../../lib/api-error';
import { formatFieldValue } from '../../lib/format';
import { qk } from '../../lib/query-keys';
import { cn } from '../../lib/cn';
import { Banner } from '../../components/ui/Banner';
import { Button, ButtonLink } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/layout/PageFrame';
import { Skeleton } from '../../components/ui/Skeleton';
import type { ActivityEntry } from '../../types/domain';
import { ActivityTimeline } from './ActivityTimeline';
import { CommentComposer } from './CommentComposer';
import { DeactivateDialog } from './DeactivateDialog';
import { LeadShareDialog } from './LeadShareDialog';
import { ReassignDialog } from './ReassignDialog';
import { RecordSummaryPanel } from './RecordSummaryPanel';

type Tab = 'timeline' | 'details';

const TABS: { id: Tab; label: string }[] = [
  { id: 'timeline', label: 'Activity' },
  { id: 'details', label: 'Details' },
];

export function Seller360Page() {
  const { sellerId } = useParams<{ sellerId: string }>();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('timeline');
  const [shareOpen, setShareOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);

  usePageChrome('Seller', sellerId ? [qk.seller(sellerId)] : []);

  const fieldsQuery = useQuery({ queryKey: qk.fields(), queryFn: configApi.fields });
  const sellerQuery = useQuery({
    queryKey: qk.seller(sellerId as string),
    queryFn: () => sellersApi.detail(sellerId as string),
    enabled: Boolean(sellerId),
    retry: (count, error) =>
      error instanceof ApiError && error.status === 404 ? false : count < 1,
  });

  const seller = sellerQuery.data;
  const firstProcess = seller?.processInstances[0];
  // Every lead mutation is authorized against a journey plus the assignment
  // types the caller claims, so these travel with all four calls below.
  const journeyContext = firstProcess
    ? {
        journeyId: firstProcess.journeyId,
        assignmentTypes: firstProcess.assignments.map((a) => a.assignmentType),
      }
    : null;

  const statusesQuery = useQuery({
    queryKey: qk.journeyStatuses(firstProcess?.journeyId ?? ''),
    queryFn: () => configApi.statuses(firstProcess!.journeyId),
    enabled: Boolean(firstProcess),
    retry: false,
  });
  const sharesQuery = useQuery({
    queryKey: ['lead-shares', sellerId],
    queryFn: () => sellersApi.shares(sellerId!, journeyContext!),
    enabled: Boolean(sellerId && journeyContext),
  });
  const activityQuery = useQuery({
    queryKey: qk.sellerActivity(sellerId as string),
    queryFn: () =>
      sellersApi.activity(sellerId!, {
        requestedFieldIds: (fieldsQuery.data ?? []).map((field) => field.id),
        assignmentTypes: journeyContext?.assignmentTypes ?? [],
      }),
    enabled: Boolean(sellerId && seller),
    retry: false,
  });

  const activityKey = qk.sellerActivity(sellerId ?? '');
  const comment = useMutation({
    mutationFn: (text: string) => sellersApi.comment(sellerId!, { ...journeyContext!, text }),
    onMutate: async (text) => {
      await qc.cancelQueries({ queryKey: activityKey });
      const previous = qc.getQueryData(activityKey);
      qc.setQueryData(
        activityKey,
        (current: { total: number; items: ActivityEntry[] } | undefined) =>
          current
            ? {
                ...current,
                total: current.total + 1,
                items: [optimisticComment(text), ...current.items],
              }
            : current,
      );
      return { previous };
    },
    // Restore the snapshot wholesale rather than removing by id — the
    // optimistic entry's id is invented and never matches the server's.
    onError: (_error, _text, context) => {
      if (context?.previous !== undefined) qc.setQueryData(activityKey, context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: activityKey }),
  });

  const reassign = useMutation({
    mutationFn: (input: { processInstanceId: string; assignmentType: string; userId: string }) =>
      sellersApi.reassign(sellerId!, { ...journeyContext!, ...input }),
    onSuccess: async () => {
      setReassignOpen(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.seller(sellerId!) }),
        qc.invalidateQueries({ queryKey: activityKey }),
        qc.invalidateQueries({ queryKey: qk.sellers() }),
      ]);
    },
  });

  const deactivate = useMutation({
    mutationFn: () => sellersApi.deactivate(sellerId!, journeyContext!),
    onSuccess: async () => {
      setDeactivateOpen(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.seller(sellerId!) }),
        qc.invalidateQueries({ queryKey: activityKey }),
        qc.invalidateQueries({ queryKey: qk.sellers() }),
        qc.invalidateQueries({ queryKey: qk.board() }),
      ]);
    },
  });

  if (sellerQuery.isError) {
    const notFound = sellerQuery.error instanceof ApiError && sellerQuery.error.status === 404;
    return (
      <div className="p-4 sm:p-6">
        {notFound ? (
          <EmptyState
            title="Seller not found"
            description="This seller doesn’t exist, or you don’t have access to it."
            action={<ButtonLink to="/sellers">Back to sellers</ButtonLink>}
          />
        ) : (
          <Banner tone="error">{friendlyErrorMessage(sellerQuery.error)}</Banner>
        )}
      </div>
    );
  }

  if (sellerQuery.isPending || !seller) {
    return (
      <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[20rem_1fr]">
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const fields = fieldsQuery.data ?? [];

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title={seller.name}
        breadcrumb={
          <Link to="/sellers" className="text-sm text-ink-soft hover:text-ink">
            ← Sellers
          </Link>
        }
        actions={
          <ButtonLink to={`/sellers/${seller.id}/edit`} variant="secondary">
            Edit seller
          </ButtonLink>
        }
      />

      <div className="mt-5 grid gap-5 lg:grid-cols-[20rem_1fr]">
        <RecordSummaryPanel
          seller={seller}
          shares={sharesQuery.data ?? []}
          actions={
            <>
              <Button variant="secondary" size="sm" onClick={() => setShareOpen(true)}>
                Share
              </Button>
              {can('leads', 'edit') ? (
                <Button variant="secondary" size="sm" onClick={() => setReassignOpen(true)}>
                  Reassign
                </Button>
              ) : null}
              {can('leads', 'delete') ? (
                <Button variant="ghost" size="sm" onClick={() => setDeactivateOpen(true)}>
                  Deactivate
                </Button>
              ) : null}
            </>
          }
        />

        <section className="min-w-0 rounded-card border border-line bg-surface shadow-[var(--shadow-card)]">
          <div role="tablist" aria-label="Record sections" className="flex border-b border-line">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={tab === entry.id}
                onClick={() => setTab(entry.id)}
                className={cn(
                  'border-b-2 px-4 py-3 text-sm font-medium transition-colors',
                  tab === entry.id
                    ? 'border-gold text-ink'
                    : 'border-transparent text-ink-soft hover:text-ink',
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div className="p-5">
            {tab === 'timeline' ? (
              <ActivityTimeline
                entries={activityQuery.data?.items ?? []}
                fields={fields}
                statuses={statusesQuery.data ?? []}
                isPending={activityQuery.isPending}
                error={activityQuery.error}
                composer={
                  can('leads', 'comment') ? (
                    <CommentComposer
                      onSubmit={(text) => comment.mutate(text)}
                      pending={comment.isPending}
                      error={comment.error}
                    />
                  ) : null
                }
              />
            ) : fieldsQuery.isPending ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                {fields
                  .filter((field) => field.key in seller.fieldValues)
                  .map((field) => (
                    <div key={field.id}>
                      <dt className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                        {field.label}
                      </dt>
                      <dd className="mt-1 text-sm text-ink">
                        {formatFieldValue(field, seller.fieldValues[field.key])}
                      </dd>
                    </div>
                  ))}
              </dl>
            )}
          </div>
        </section>
      </div>

      {shareOpen && journeyContext ? (
        <LeadShareDialog
          leadId={seller.id}
          journeyId={journeyContext.journeyId}
          assignmentTypes={journeyContext.assignmentTypes}
          onClose={() => setShareOpen(false)}
        />
      ) : null}
      {reassignOpen ? (
        <ReassignDialog
          processes={seller.processInstances}
          onClose={() => setReassignOpen(false)}
          onSubmit={(input) => reassign.mutate(input)}
          pending={reassign.isPending}
          error={reassign.error}
        />
      ) : null}
      {deactivateOpen ? (
        <DeactivateDialog
          sellerName={seller.name}
          onClose={() => setDeactivateOpen(false)}
          onConfirm={() => deactivate.mutate()}
          pending={deactivate.isPending}
          error={deactivate.error}
        />
      ) : null}
    </div>
  );
}

/** Shown until the server's row replaces it on invalidate. */
function optimisticComment(text: string): ActivityEntry {
  return {
    id: `optimistic-${Date.now()}`,
    processInstanceId: null,
    actorUserId: null,
    actorName: null,
    timestamp: new Date().toISOString(),
    actionType: 'comment',
    source: 'lead_api',
    commentText: text,
    oldValue: null,
    newValue: null,
  };
}
