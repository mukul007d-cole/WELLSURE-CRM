import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * The table chrome dense CRM lists need.
 *
 * Three things separate a data table from a styled `<table>`: a header that
 * stays put while you scan, a recessed header tone so the column labels stop
 * competing with the data, and row affordances that appear on hover instead
 * of adding permanent visual noise to every row.
 */
export function DataTable({
  headers,
  children,
  caption,
  density = 'comfortable',
  maxHeightClass = 'max-h-[calc(100dvh-22rem)]',
}: {
  /** Pass an empty string for a column that holds only controls. */
  headers: (string | { label: string; align?: 'right'; width?: string })[];
  children: ReactNode;
  caption?: string;
  /** Honours the user's table-density preference. */
  density?: 'comfortable' | 'compact';
  maxHeightClass?: string;
}) {
  return (
    <div
      className={cn('overflow-auto', maxHeightClass)}
      // Cells read this rather than each caller threading a padding class.
      style={{ '--data-row-py': density === 'compact' ? '0.3125rem' : '0.625rem' } as CSSProperties}
    >
      <table className="w-full border-collapse text-left">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="sticky top-0 z-10">
          <tr>
            {headers.map((header, index) => {
              const config = typeof header === 'string' ? { label: header } : header;
              return (
                <th
                  key={`${config.label}-${index}`}
                  scope="col"
                  style={config.width ? { width: config.width } : undefined}
                  className={cn(
                    'border-b border-line bg-surface-sunken px-4 py-2 text-eyebrow uppercase text-ink-soft',
                    config.align === 'right' && 'text-right',
                  )}
                >
                  {config.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function DataRow({
  children,
  selected,
  onClick,
}: {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        'group border-b border-line-soft transition-colors last:border-b-0',
        selected ? 'bg-gold-soft/25' : 'hover:bg-surface-hover',
        onClick && 'cursor-pointer',
      )}
    >
      {children}
    </tr>
  );
}

export function DataCell({
  children,
  align,
  className,
  primary,
}: {
  children: ReactNode;
  align?: 'right';
  className?: string;
  /** The identifying column — carries the row's weight. */
  primary?: boolean;
}) {
  return (
    <td
      className={cn(
        'px-4 py-[var(--data-row-py,0.625rem)] text-sm',
        primary ? 'font-medium text-ink' : 'text-ink-muted',
        align === 'right' && 'text-right',
        className,
      )}
    >
      {children}
    </td>
  );
}

/** Actions that stay out of the way until the row is hovered or focused. */
export function RowActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
      {children}
    </div>
  );
}
