import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../app/AuthContext';
import { usePageChrome } from '../../app/page-chrome';
import { JourneyTabs } from '../../components/journeys/JourneyTabs';
import { Banner } from '../../components/ui/Banner';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Select } from '../../components/ui/Select';
import { Skeleton } from '../../components/ui/Skeleton';
import { configApi, sellersApi } from '../../lib/api-client';
import { ApiError, friendlyErrorMessage } from '../../lib/api-error';
import { qk } from '../../lib/query-keys';
import type { SellerListRow, Status } from '../../types/domain';
import { AdminHeader } from '../admin/shared';
import { BoardCardBody } from './BoardCard';
import { BoardColumn } from './BoardColumn';
import { MoveRejectedDialog } from './MoveRejectedDialog';
import { adjacentColumnCoordinates } from './keyboard-coordinates';
import { useMoveLeadStatus, type MoveRejection, type MoveVariables } from './useMoveLeadStatus';

interface DragPayload {
  row: SellerListRow;
  process: { processInstanceId: string; journeyId: string; ownerName: string | null };
  fromStatus: Status;
}

export function BoardPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = can('leads', 'edit');

  const [selectedJourneyId, setSelectedJourneyId] = useState<string | undefined>(undefined);
  const [mobileStatusId, setMobileStatusId] = useState<string | undefined>(undefined);
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [rejection, setRejection] = useState<MoveRejection | null>(null);
  const [announcement, setAnnouncement] = useState('');

  usePageChrome('Board', [qk.board(), qk.journeys()]);

  const journeysQuery = useQuery({ queryKey: qk.journeys(), queryFn: configApi.journeys });

  // The board is per-journey by definition — its columns are one journey's
  // statuses — so fall back to the first rather than showing nothing. Derived
  // during render rather than in an effect, to avoid a cascading re-render.
  const journeys = journeysQuery.data ?? [];
  const journeyId = selectedJourneyId ?? journeys[0]?.id;

  const statusesQuery = useQuery({
    queryKey: qk.journeyStatuses(journeyId as string),
    queryFn: () => configApi.statuses(journeyId as string),
    enabled: Boolean(journeyId),
    staleTime: 300_000,
  });

  const statuses = (statusesQuery.data ?? []).filter((status) => status.isActive);

  const fieldsQuery = useQuery({
    queryKey: qk.fields(),
    queryFn: configApi.fields,
    // Field labels sit behind fields:view; the dialog copes without them.
    retry: false,
  });

  const move = useMoveLeadStatus({
    onRejected: (result) => {
      setRejection(result);
      setAnnouncement(
        result.kind === 'missing_field'
          ? `Move refused. ${result.variables.row.name} stayed in ${result.variables.fromStatus.name} because a required field is missing.`
          : 'Move refused. The card returned to its original column.',
      );
    },
    onMoved: (variables) =>
      setAnnouncement(`Moved ${variables.row.name} to ${variables.toStatus.name}.`),
  });

  const runMove = (args: {
    row: SellerListRow;
    processInstanceId: string;
    fromStatus: Status;
    toStatus: Status;
  }) => {
    if (!journeyId) return;
    const variables: MoveVariables = { ...args, journeyId };
    setAnnouncement(`Moving ${args.row.name} to ${args.toStatus.name}…`);
    move.mutate(variables);
  };

  const onDragStart = (event: DragStartEvent) => {
    const payload = event.active.data.current as DragPayload | undefined;
    if (!payload) return;
    setDragging(payload);
    // Warm the lead detail so the mutation can read assignmentTypes without an
    // extra round trip at drop time.
    void queryClient.prefetchQuery({
      queryKey: qk.seller(payload.row.id),
      queryFn: () => sellersApi.detail(payload.row.id),
      staleTime: 60_000,
    });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const payload = event.active.data.current as DragPayload | undefined;
    setDragging(null);
    const toStatus = event.over?.data.current?.['status'] as Status | undefined;
    if (!payload || !toStatus || toStatus.id === payload.fromStatus.id) return;
    runMove({
      row: payload.row,
      processInstanceId: payload.process.processInstanceId,
      fromStatus: payload.fromStatus,
      toStatus,
    });
  };

  const sensors = useSensors(
    // A small threshold so a plain click still follows the card's link.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: adjacentColumnCoordinates }),
  );

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const payload = active.data.current as DragPayload | undefined;
      return payload
        ? `Picked up ${payload.row.name} from ${payload.fromStatus.name}. Use the left and right arrow keys to move between statuses, space to drop, escape to cancel.`
        : undefined;
    },
    onDragOver: ({ over }) => {
      const status = over?.data.current?.['status'] as Status | undefined;
      return status ? `Over ${status.name}.` : undefined;
    },
    onDragEnd: ({ over }) => {
      const status = over?.data.current?.['status'] as Status | undefined;
      return status ? `Dropped on ${status.name}.` : 'Dropped outside a status.';
    },
    onDragCancel: ({ active }) => {
      const payload = active.data.current as DragPayload | undefined;
      return payload
        ? `Move cancelled. ${payload.row.name} stays in ${payload.fromStatus.name}.`
        : undefined;
    },
  };

  const configForbidden =
    (journeysQuery.error instanceof ApiError && journeysQuery.error.status === 403) ||
    (statusesQuery.error instanceof ApiError && statusesQuery.error.status === 403);

  const fieldLabel =
    rejection?.kind === 'missing_field'
      ? ((fieldsQuery.data ?? []).find((field) => field.id === rejection.fieldId)?.label ?? null)
      : null;

  const visibleStatuses =
    mobileStatusId === undefined
      ? statuses
      : statuses.filter((status) => status.id === mobileStatusId);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 p-4 pb-0 sm:p-6 sm:pb-0">
        <AdminHeader
          title="Board"
          description="Sellers by status. Drag a card, or use its Move menu, to change status."
        />

        {!canEdit ? (
          <Banner tone="info">
            You can view the board, but moving sellers between statuses needs edit access.
          </Banner>
        ) : null}

        {rejection && rejection.kind !== 'missing_field' ? (
          <Banner tone="error">
            {rejection.kind === 'forbidden'
              ? "You don't have permission to move that seller."
              : rejection.kind === 'stale_status'
                ? "That status isn't available on this journey any more — the board has been refreshed."
                : friendlyErrorMessage(rejection.error)}
          </Banner>
        ) : null}
      </div>

      <Card className="mx-4 mt-4 flex min-h-0 flex-1 flex-col overflow-hidden sm:mx-6">
        <div className="border-b border-line">
          <JourneyTabs
            journeys={journeys}
            activeJourneyId={journeyId}
            onSelect={(id) => {
              setSelectedJourneyId(id);
              setMobileStatusId(undefined);
            }}
            allowAll={false}
          />
        </div>

        {configForbidden ? (
          <div className="p-5">
            <EmptyState
              title="Journey configuration isn't visible to your role"
              description="Your role can see sellers but not the journeys and statuses this board is built from. An administrator can grant journey and status visibility."
            />
          </div>
        ) : statusesQuery.isError ? (
          <div className="p-5">
            <Banner tone="error">{friendlyErrorMessage(statusesQuery.error)}</Banner>
          </div>
        ) : !journeyId || statusesQuery.isPending ? (
          <div className="flex gap-4 p-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-64 w-[17.5rem] shrink-0 rounded-card" />
            ))}
          </div>
        ) : statuses.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="This journey has no active statuses"
              description="Add statuses to this journey to build a board from them."
            />
          </div>
        ) : (
          <>
            {/* Phones get one column at a time rather than a horizontal scroll. */}
            <div className="border-b border-line p-3 sm:hidden">
              <label htmlFor="board-status" className="sr-only">
                Status to show
              </label>
              <Select
                id="board-status"
                value={mobileStatusId ?? ''}
                onChange={(event) => setMobileStatusId(event.target.value || undefined)}
              >
                <option value="">All statuses</option>
                {statuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.name}
                  </option>
                ))}
              </Select>
            </div>

            <DndContext
              sensors={canEdit ? sensors : []}
              collisionDetection={closestCorners}
              accessibility={{ announcements }}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragCancel={() => setDragging(null)}
            >
              <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto p-4">
                {visibleStatuses.map((status) => (
                  <BoardColumn
                    key={status.id}
                    journeyId={journeyId}
                    status={status}
                    statuses={statuses}
                    canEdit={canEdit}
                    onMove={runMove}
                  />
                ))}
              </div>

              <DragOverlay>
                {dragging ? (
                  <div className="w-[16.5rem]">
                    <BoardCardBody
                      row={dragging.row}
                      ownerName={dragging.process.ownerName}
                      lifted
                    />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </>
        )}
      </Card>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {rejection?.kind === 'missing_field' ? (
        <MoveRejectedDialog
          variables={rejection.variables}
          fieldLabel={fieldLabel}
          onClose={() => setRejection(null)}
        />
      ) : null}
    </div>
  );
}
