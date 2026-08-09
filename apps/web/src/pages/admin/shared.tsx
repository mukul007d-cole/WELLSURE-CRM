import type { ComponentProps, ReactNode } from 'react';
import { EmptyState } from '../../components/ui/EmptyState';
import { Select } from '../../components/ui/Select';
import { DataTable } from '../../components/ui/DataTable';
import { ADMIN_PAGE_SIZE } from '../../lib/api-client';
import type { Page } from '../../types/domain';

export { ADMIN_PAGE_SIZE };

export function ActiveFilter({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm">
        Active
      </label>
      <Select
        id={id}
        className="w-40"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="true">Active</option>
        <option value="false">Inactive</option>
        <option value="all">All</option>
      </Select>
    </div>
  );
}

/**
 * The admin list table.
 *
 * A thin wrapper over the shared `DataTable` rather than its own `<table>`:
 * the loading and empty states below are the only thing the admin CRUD pages
 * need that the primitive doesn't provide, and duplicating table chrome is how
 * the two design systems diverged in the first place.
 */
export function AdminTable({
  headers,
  children,
  empty,
  loading,
  caption,
}: {
  /** Same shape as `DataTable` — a bare string, or a config for alignment. */
  headers: ComponentProps<typeof DataTable>['headers'];
  children: ReactNode;
  empty: boolean;
  loading?: boolean;
  caption?: string;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface shadow-[var(--shadow-card)]">
      <DataTable
        headers={headers}
        maxHeightClass="max-h-[calc(100dvh-26rem)]"
        {...(caption ? { caption } : {})}
      >
        {children}
      </DataTable>
      {loading ? (
        <p className="p-4 text-sm text-ink-soft" role="status">
          Loading records…
        </p>
      ) : null}
      {empty ? (
        <EmptyState
          title="No records found"
          description="Try changing the active filter or create the first record."
        />
      ) : null}
    </div>
  );
}

export function activeValue(value: string): boolean | undefined {
  return value === 'all' ? undefined : value === 'true';
}

export async function loadAllPages<T>(
  load: (page: number, pageSize: number) => Promise<Page<T>>,
): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  let total: number;
  do {
    const result = await load(page, 100);
    items.push(...result.items);
    total = result.total;
    page += 1;
  } while (items.length < total);
  return items;
}
