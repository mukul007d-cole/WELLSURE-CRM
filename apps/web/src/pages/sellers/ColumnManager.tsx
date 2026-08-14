import type { SellerColumn } from '../../app/preferences';
import { Checkbox } from '../../components/ui/Checkbox';

const OPTIONS: Array<{ id: SellerColumn; label: string }> = [
  { id: 'journey', label: 'Journey' },
  { id: 'status', label: 'Status' },
  { id: 'owner', label: 'Owner' },
];

export function ColumnManager({
  columns,
  onChange,
}: {
  columns: SellerColumn[];
  onChange: (columns: SellerColumn[]) => void;
}) {
  return (
    <details className="relative">
      <summary className="flex h-10 cursor-pointer list-none items-center rounded-control border border-line-strong bg-surface px-3 text-sm font-medium text-ink hover:border-ink">
        Columns
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-52 rounded-card border border-line bg-surface p-3 shadow-[var(--shadow-popover)]">
        <p className="mb-2 text-xs text-ink-soft">Seller is always shown.</p>
        <div className="flex flex-col gap-2.5">
          {OPTIONS.map((option) => (
            <Checkbox
              key={option.id}
              id={`seller-column-${option.id}`}
              label={option.label}
              checked={columns.includes(option.id)}
              onChange={(event) => {
                if (event.target.checked) onChange([...columns, option.id]);
                else if (columns.length > 1)
                  onChange(columns.filter((column) => column !== option.id));
              }}
            />
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-soft">Keep at least one context column visible.</p>
      </div>
    </details>
  );
}
