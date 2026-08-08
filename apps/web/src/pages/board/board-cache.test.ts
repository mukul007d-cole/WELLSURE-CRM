import { describe, expect, it } from 'vitest';
import type { InfiniteData } from '@tanstack/react-query';
import type { SellerListResponse, SellerListRow, Status } from '../../types/domain';
import { columnTotal, insertRowAtHead, patchRowStatus, removeRow } from './board-cache';

function row(id: string, statusId = 'status-1'): SellerListRow {
  return {
    id,
    name: `Seller ${id}`,
    phone: null,
    email: null,
    fieldValues: {},
    processInstances: [
      {
        processInstanceId: `pi-${id}`,
        journeyId: 'journey-1',
        journeyName: 'Journey One',
        statusId,
        statusName: 'Status One',
        statusOutcomeType: 'open',
        statusBehaviorType: 'default',
        ownerName: null,
      },
    ],
  };
}

function column(pages: { total: number; ids: string[] }[]): InfiniteData<SellerListResponse> {
  return {
    pages: pages.map((page) => ({ total: page.total, rows: page.ids.map((id) => row(id)) })),
    pageParams: pages.map((_, index) => index + 1),
  };
}

const targetStatus: Status = {
  id: 'status-2',
  journeyId: 'journey-1',
  key: 'won',
  name: 'Status Two',
  outcomeType: 'closed_won',
  behaviorType: 'default',
  isActive: true,
  sortOrder: 2,
  isDefaultOnCreate: false,
};

describe('removeRow', () => {
  it('drops the row and decrements the total on every page exactly once', () => {
    const result = removeRow(
      column([
        { total: 7, ids: ['a', 'b'] },
        { total: 7, ids: ['c'] },
      ]),
      'b',
    );

    expect(result!.pages.map((page) => page.total)).toEqual([6, 6]);
    expect(result!.pages.flatMap((page) => page.rows.map((r) => r.id))).toEqual(['a', 'c']);
  });

  it('is a no-op when the row is not in this column', () => {
    const before = column([{ total: 3, ids: ['a'] }]);
    expect(removeRow(before, 'not-here')).toBe(before);
  });

  it('never drives the total below zero', () => {
    const result = removeRow(column([{ total: 0, ids: ['a'] }]), 'a');
    expect(columnTotal(result)).toBe(0);
  });

  it('leaves an unfetched column alone', () => {
    expect(removeRow(undefined, 'a')).toBeUndefined();
  });
});

describe('insertRowAtHead', () => {
  it('prepends to the first page only and increments every page total', () => {
    const result = insertRowAtHead(
      column([
        { total: 4, ids: ['a'] },
        { total: 4, ids: ['b'] },
      ]),
      row('new'),
    );

    expect(result!.pages.map((page) => page.total)).toEqual([5, 5]);
    expect(result!.pages[0]!.rows.map((r) => r.id)).toEqual(['new', 'a']);
    expect(result!.pages[1]!.rows.map((r) => r.id)).toEqual(['b']);
  });

  it('does not double-count a row already in the column', () => {
    const result = insertRowAtHead(column([{ total: 2, ids: ['a', 'b'] }]), row('b'));

    expect(columnTotal(result)).toBe(2);
    expect(result!.pages[0]!.rows.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('leaves an unfetched column alone, so its first load shows server truth', () => {
    expect(insertRowAtHead(undefined, row('a'))).toBeUndefined();
  });
});

describe('patchRowStatus', () => {
  it('rewrites only the moved process instance', () => {
    const source = row('a');
    source.processInstances = [
      ...source.processInstances!,
      {
        processInstanceId: 'pi-other',
        journeyId: 'journey-2',
        journeyName: 'Journey Two',
        statusId: 'status-9',
        statusName: 'Untouched',
        statusOutcomeType: 'open',
        statusBehaviorType: 'default',
        ownerName: null,
      },
    ];

    const patched = patchRowStatus(source, 'pi-a', targetStatus);

    expect(patched.processInstances![0]).toMatchObject({
      statusId: 'status-2',
      statusName: 'Status Two',
      statusOutcomeType: 'closed_won',
    });
    expect(patched.processInstances![1]!.statusName).toBe('Untouched');
  });
});
