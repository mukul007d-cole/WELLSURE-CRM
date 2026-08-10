import type { InfiniteData } from '@tanstack/react-query';
import type { SellerListResponse, SellerListRow, Status } from '../../types/domain';

export type ColumnData = InfiniteData<SellerListResponse> | undefined;

/**
 * Column caches are `InfiniteData`, so `total` is repeated on every page object
 * — the header reads `pages[0].total`, but leaving the later pages stale would
 * make the count flicker as soon as another page loads. Every helper here
 * therefore applies the delta uniformly across pages.
 *
 * These are pure on purpose: the optimistic move is the riskiest logic in the
 * board, and it's far easier to trust when the arithmetic can be unit-tested
 * without React, a query client, or a rendered tree.
 */
export function removeRow(data: ColumnData, leadId: string): ColumnData {
  if (!data) return data;

  const present = data.pages.some((page) => page.rows.some((row) => row.id === leadId));
  if (!present) return data;

  return {
    ...data,
    pages: data.pages.map((page) => ({
      total: Math.max(0, page.total - 1),
      rows: page.rows.filter((row) => row.id !== leadId),
    })),
  };
}

export function insertRowAtHead(data: ColumnData, row: SellerListRow): ColumnData {
  if (!data) return data;

  const alreadyPresent = data.pages.some((page) =>
    page.rows.some((existing) => existing.id === row.id),
  );

  return {
    ...data,
    pages: data.pages.map((page, index) => {
      const withoutRow = page.rows.filter((existing) => existing.id !== row.id);
      return {
        // Re-inserting a row that's already in this column isn't a new arrival.
        total: alreadyPresent ? page.total : page.total + 1,
        rows: index === 0 ? [row, ...withoutRow] : withoutRow,
      };
    }),
  };
}

/**
 * Rewrites the moved process instance so the optimistically-placed card shows
 * its new status immediately. Other process instances on the same lead are
 * untouched — only the one being dragged moved.
 */
export function patchRowStatus(
  row: SellerListRow,
  processInstanceId: string,
  status: Status,
): SellerListRow {
  if (!row.processInstances) return row;

  return {
    ...row,
    processInstances: row.processInstances.map((process) =>
      process.processInstanceId === processInstanceId
        ? {
            ...process,
            statusId: status.id,
            statusName: status.name,
            statusOutcomeType: status.outcomeType,
            statusBehaviorType: status.behaviorType,
          }
        : process,
    ),
  };
}

/** Rows currently loaded into a column, flattened across its pages. */
export function columnRows(data: ColumnData): SellerListRow[] {
  return (data?.pages ?? []).flatMap((page) => page.rows);
}

/** The server-side scoped count for a column, not the number of loaded rows. */
export function columnTotal(data: ColumnData): number | undefined {
  return data?.pages[0]?.total;
}
