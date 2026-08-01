import type { ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Select } from '../../components/ui/Select';
import { ADMIN_PAGE_SIZE } from '../../lib/api-client';
import type { Page } from '../../types/domain';

export { ADMIN_PAGE_SIZE };

export function AdminHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-2xl font-bold">{title}</h2>
        <p className="text-sm text-ink-soft">{description}</p>
      </div>
      {action}
    </div>
  );
}

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

export function AdminTable({
  headers,
  children,
  empty,
  loading,
}: {
  headers: string[];
  children: ReactNode;
  empty: boolean;
  loading?: boolean;
}) {
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b text-xs uppercase text-ink-soft">
            {headers.map((header) => (
              <th className="p-4" key={header}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {loading ? (
        <p className="p-4" role="status">
          Loading records…
        </p>
      ) : null}
      {empty ? (
        <EmptyState
          title="No records found"
          description="Try changing the active filter or create the first record."
        />
      ) : null}
    </Card>
  );
}

export function PageControls({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between">
      <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span className="text-sm text-ink-soft">
        Page {page} of {lastPage} · {total} total
      </span>
      <Button variant="secondary" disabled={page >= lastPage} onClick={() => onPage(page + 1)}>
        Next
      </Button>
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
  let total = 0;
  do {
    const result = await load(page, 100);
    items.push(...result.items);
    total = result.total;
    page += 1;
  } while (items.length < total);
  return items;
}
