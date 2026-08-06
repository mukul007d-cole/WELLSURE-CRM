import { useDroppable } from '@dnd-kit/core';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { statusTone, STATUS_TONE_VAR } from '../../components/ui/status-tone';
import { sellersApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import { BOARD_PAGE_SIZE } from '../../lib/constants';
import { qk } from '../../lib/query-keys';
import { cn } from '../../lib/cn';
import type { SellerListResponse, Status } from '../../types/domain';
import { BoardCard } from './BoardCard';
import { columnRows, columnTotal } from './board-cache';

export function useColumnQuery(journeyId: string, statusId: string) {
  return useInfiniteQuery({
    queryKey: qk.boardColumn(journeyId, statusId),
    queryFn: ({ pageParam }) =>
      sellersApi.list({
        journeyId,
        statusId,
        page: pageParam,
        pageSize: BOARD_PAGE_SIZE,
        sortBy: 'updatedAt',
        sortDirection: 'desc',
        accessMode: 'all',
      }),
    initialPageParam: 1,
    getNextPageParam: (last: SellerListResponse, all: SellerListResponse[]) => {
      const loaded = all.reduce((count, page) => count + page.rows.length, 0);
      return loaded < last.total ? all.length + 1 : undefined;
    },
  });
}

export function BoardColumn({
  journeyId,
  status,
  statuses,
  canEdit,
  onMove,
}: {
  journeyId: string;
  status: Status;
  statuses: Status[];
  canEdit: boolean;
  onMove: (args: {
    row: SellerListResponse['rows'][number];
    processInstanceId: string;
    fromStatus: Status;
    toStatus: Status;
  }) => void;
}) {
  const query = useColumnQuery(journeyId, status.id);
  const { setNodeRef, isOver } = useDroppable({ id: status.id, data: { status } });

  const rows = columnRows(query.data);
  // The server's scoped count, not the number of rows loaded so far.
  const total = columnTotal(query.data);
  const tone = statusTone(status.outcomeType, status.behaviorType);

  return (
    <section
      className={cn(
        'flex w-[17.5rem] shrink-0 flex-col rounded-card border bg-paper/60 transition-colors',
        isOver && canEdit ? 'border-gold bg-gold-soft/20' : 'border-line',
      )}
      aria-label={status.name}
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: STATUS_TONE_VAR[tone] }}
        />
        <h3 className="min-w-0 flex-1 truncate font-display text-sm font-semibold text-ink">
          {status.name}
        </h3>
        {total === undefined ? (
          <Skeleton className="h-5 w-7" />
        ) : (
          <span className="rounded-pill bg-surface px-2 py-0.5 text-xs font-semibold tabular-nums text-ink-soft">
            {total}
          </span>
        )}
      </header>

      <div ref={setNodeRef} className="flex-1 overflow-y-auto p-2.5 lg:max-h-[calc(100dvh-19rem)]">
        {query.isError ? (
          <Banner tone="error">{friendlyErrorMessage(query.error)}</Banner>
        ) : query.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-[4.5rem] w-full rounded-card" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-ink-soft">No sellers here.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => {
              const process = row.processInstances?.find(
                (candidate) => candidate.statusId === status.id,
              );
              if (!process) return null;
              return (
                <BoardCard
                  key={`${row.id}::${process.processInstanceId}`}
                  row={row}
                  process={{
                    processInstanceId: process.processInstanceId,
                    journeyId: process.journeyId,
                    ownerName: process.ownerName,
                  }}
                  status={status}
                  statuses={statuses}
                  canEdit={canEdit}
                  onMove={(toStatus) =>
                    onMove({
                      row,
                      processInstanceId: process.processInstanceId,
                      fromStatus: status,
                      toStatus,
                    })
                  }
                />
              );
            })}
          </ul>
        )}

        {query.hasNextPage ? (
          <Button
            className="mt-2 w-full"
            variant="secondary"
            size="sm"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Load more
          </Button>
        ) : null}
      </div>
    </section>
  );
}
