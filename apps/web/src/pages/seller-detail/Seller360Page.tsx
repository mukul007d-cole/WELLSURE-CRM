import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../../app/AuthContext';
import { usePageChrome } from '../../app/page-chrome';
import { adminApi, configApi, sellersApi } from '../../lib/api-client';
import { ApiError, friendlyErrorMessage } from '../../lib/api-error';
import { qk } from '../../lib/query-keys';
import { loadAllPages } from '../admin/shared';
import { Tabs, TabPanel, useTabGroup, type TabItem } from '../../components/ui/Tabs';
import { Banner } from '../../components/ui/Banner';
import { Button, ButtonLink } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/layout/PageFrame';
import { Skeleton } from '../../components/ui/Skeleton';
import type { ActivityEntry } from '../../types/domain';
import { ActivityTimeline } from './ActivityTimeline';
import { CallHistoryTab } from './CallHistoryTab';
import { CommentComposer } from './CommentComposer';
import { DetailsTab } from './DetailsTab';
import { DocumentLockerTab } from './DocumentLockerTab';
import { JourneyDialog, type JourneyAction } from './JourneyDialog';
import { RepeatLeadTab, useRepeatLeads } from './RepeatLeadTab';
import { downloadRecordPdf } from './record-pdf';
import { DeactivateDialog } from './DeactivateDialog';
import { LeadShareDialog } from './LeadShareDialog';
import { ReassignDialog } from './ReassignDialog';
import { RecordSummaryPanel } from './RecordSummaryPanel';

type Tab = 'timeline' | 'details' | 'documents' | 'repeats' | 'calls';

export function Seller360Page() {
  const { sellerId } = useParams<{ sellerId: string }>();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('timeline');
  const tabGroup = useTabGroup();
  const [shareOpen, setShareOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [journeyAction, setJourneyAction] = useState<JourneyAction | null>(null);
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);

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
  const selectedProcess = seller
    ? (seller.processInstances.find((process) => process.processInstanceId === selectedProcessId) ??
      seller.processInstances.find((process) => process.isPrimary) ??
      seller.processInstances[0])
    : undefined;
  // Every lead mutation is authorized against a journey plus the assignment
  // types the caller claims, so these travel with all four calls below.
  const journeyContext = selectedProcess
    ? {
        journeyId: selectedProcess.journeyId,
        assignmentTypes: selectedProcess.assignments.map((a) => a.assignmentType),
      }
    : null;

  const statusesQuery = useQuery({
    queryKey: qk.journeyStatuses(selectedProcess?.journeyId ?? ''),
    queryFn: () => configApi.statuses(selectedProcess!.journeyId),
    enabled: Boolean(selectedProcess),
    retry: false,
  });
  const sharesQuery = useQuery({
    queryKey: ['lead-shares', sellerId],
    queryFn: () => sellersApi.shares(sellerId!, journeyContext!),
    enabled: Boolean(sellerId && journeyContext),
  });
  // Names for the from/to sides of a reassignment entry. The activity payload
  // carries user ids only, and there is no batch by-ids endpoint, so this is
  // the same paged directory the org chart already caches.
  const directoryQuery = useQuery({
    queryKey: qk.directoryUsers(),
    queryFn: () => loadAllPages((page, pageSize) => adminApi.users({ page, pageSize })),
    enabled: can('users', 'view'),
    staleTime: 300_000,
  });
  const repeatNeedle = (seller?.phone ?? seller?.email ?? '').trim() || null;
  const repeatsQuery = useRepeatLeads(sellerId ?? '', seller?.phone ?? null, seller?.email ?? null);
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
    mutationFn: (input: { processInstanceId: string; assignmentType: string; userId: string }) => {
      const process = seller!.processInstances.find(
        (candidate) => candidate.processInstanceId === input.processInstanceId,
      )!;
      return sellersApi.reassign(sellerId!, {
        journeyId: process.journeyId,
        assignmentTypes: process.assignments.map((assignment) => assignment.assignmentType),
        ...input,
      });
    },
    onSuccess: async () => {
      setReassignOpen(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.seller(sellerId!) }),
        qc.invalidateQueries({ queryKey: activityKey }),
        qc.invalidateQueries({ queryKey: qk.sellers() }),
      ]);
    },
  });

  const journeyMove = useMutation({
    mutationFn: (input: {
      processInstanceId: string;
      targetJourneyId: string;
      statusId: string | undefined;
    }): Promise<unknown> => {
      const source = seller!.processInstances.find(
        (candidate) => candidate.processInstanceId === input.processInstanceId,
      )!;
      const sourceContext = {
        journeyId: source.journeyId,
        assignmentTypes: source.assignments.map((assignment) => assignment.assignmentType),
      };
      return journeyAction === 'move'
        ? sellersApi.moveJourney(sellerId!, {
            ...sourceContext,
            processInstanceId: input.processInstanceId,
            targetJourneyId: input.targetJourneyId,
            ...(input.statusId ? { statusId: input.statusId } : {}),
          })
        : // Adding reuses the create endpoint's existingLeadId path, which
          // overwrites the lead's core fields — so send the current values
          // back unchanged rather than letting it blank them.
          sellersApi.create({
            existingLeadId: sellerId!,
            journeyId: input.targetJourneyId,
            ...(input.statusId ? { statusId: input.statusId } : {}),
            name: seller?.name ?? '',
            phone: seller?.phone ?? null,
            email: seller?.email ?? null,
            fieldValues: {},
            assignments:
              source.assignments.map((assignment) => ({
                assignmentType: assignment.assignmentType,
                userId: assignment.userId,
              })) ?? [],
          });
    },
    onSuccess: async () => {
      setJourneyAction(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.seller(sellerId!) }),
        qc.invalidateQueries({ queryKey: activityKey }),
        qc.invalidateQueries({ queryKey: qk.sellers() }),
        qc.invalidateQueries({ queryKey: qk.board() }),
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
  const orderedProcesses = selectedProcess
    ? [
        selectedProcess,
        ...seller.processInstances.filter(
          (process) => process.processInstanceId !== selectedProcess.processInstanceId,
        ),
      ]
    : seller.processInstances;
  const repeatCount = repeatsQuery.data?.length ?? 0;
  const tabItems: TabItem<Tab>[] = [
    { id: 'timeline', label: 'Activity' },
    { id: 'details', label: 'Details' },
    { id: 'documents', label: 'Documents' },
    // Only badge a real, non-zero count — a "0" chip reads as a broken feature.
    { id: 'repeats', label: 'Repeat lead', ...(repeatCount > 0 ? { badge: repeatCount } : {}) },
    { id: 'calls', label: 'Call history' },
  ];

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title={seller.name}
        {...(seller.processInstances.length > 1
          ? { description: `Working in ${selectedProcess?.journey.name ?? 'the selected journey'}` }
          : {})}
        breadcrumb={
          <Link to="/sellers" className="text-sm text-ink-soft hover:text-ink">
            ← Sellers
          </Link>
        }
        actions={
          <div className="flex items-center gap-1.5">
            {can('leads', 'edit') ? (
              <IconButton
                label="Move to another journey"
                onClick={() => setJourneyAction('move')}
                // Two arrows crossing: this record leaves one journey for another.
                d="M7 7h11l-3-3M17 17H6l3 3"
              />
            ) : null}
            {can('leads', 'create') ? (
              <IconButton
                label="Add to another journey"
                onClick={() => setJourneyAction('add')}
                d="M12 5v14M5 12h14"
              />
            ) : null}
            <IconButton
              label="Download as PDF"
              onClick={() => downloadRecordPdf(seller, fields)}
              d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"
            />
            <ButtonLink to={`/sellers/${seller.id}/edit`} variant="secondary">
              Edit seller
            </ButtonLink>
          </div>
        }
      />

      {seller.processInstances.length > 1 ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-y border-line bg-surface-sunken px-4 py-3">
          <label htmlFor="seller-journey-context" className="text-sm font-medium text-ink">
            Journey context
          </label>
          <select
            id="seller-journey-context"
            value={selectedProcess?.processInstanceId ?? ''}
            onChange={(event) => setSelectedProcessId(event.target.value)}
            className="h-9 min-w-52 rounded-control border border-line-strong bg-surface px-3 text-sm text-ink"
          >
            {seller.processInstances.map((process) => (
              <option key={process.processInstanceId} value={process.processInstanceId}>
                {process.journey.name}
                {process.isPrimary ? ' (Primary)' : ''} — {process.currentStatus.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-ink-soft">
            Sharing, activity, documents, and record actions use this journey.
          </span>
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[20rem_1fr]">
        <RecordSummaryPanel
          seller={seller}
          {...(selectedProcess ? { selectedProcessId: selectedProcess.processInstanceId } : {})}
          shares={sharesQuery.data ?? []}
          repeatCount={repeatCount}
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
          <Tabs
            groupId={tabGroup}
            items={tabItems}
            active={tab}
            onChange={setTab}
            label="Record sections"
          />

          <TabPanel groupId={tabGroup} id={tab} className="p-5">
            {tab === 'timeline' ? (
              <ActivityTimeline
                entries={activityQuery.data?.items ?? []}
                fields={fields}
                statuses={statusesQuery.data ?? []}
                directory={directoryQuery.data ?? []}
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
            ) : tab === 'details' ? (
              <DetailsTab
                fields={fields}
                fieldValues={seller.fieldValues}
                isPending={fieldsQuery.isPending}
              />
            ) : tab === 'documents' ? (
              <DocumentLockerTab leadId={seller.id} journeyContext={journeyContext} />
            ) : tab === 'repeats' ? (
              <RepeatLeadTab
                matches={repeatsQuery.data ?? []}
                isPending={repeatsQuery.isPending && repeatNeedle !== null}
                error={repeatsQuery.error}
                matchedOn={repeatNeedle}
              />
            ) : (
              <CallHistoryTab />
            )}
          </TabPanel>
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
          processes={orderedProcesses}
          onClose={() => setReassignOpen(false)}
          onSubmit={(input) => reassign.mutate(input)}
          pending={reassign.isPending}
          error={reassign.error}
        />
      ) : null}
      {journeyAction ? (
        <JourneyDialog
          action={journeyAction}
          processes={orderedProcesses}
          onClose={() => setJourneyAction(null)}
          onSubmit={(input) => journeyMove.mutate(input)}
          pending={journeyMove.isPending}
          error={journeyMove.error}
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

/**
 * The record's icon actions. No IconButton primitive exists yet and these are
 * the only three, so the shape stays local rather than inventing a component
 * for one caller.
 */
function IconButton({ label, onClick, d }: { label: string; onClick: () => void; d: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-control border border-line text-ink-soft transition-colors hover:border-ink hover:text-ink"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d={d}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
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
