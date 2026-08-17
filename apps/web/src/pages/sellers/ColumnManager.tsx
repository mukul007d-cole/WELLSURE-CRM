import type { SellerColumn } from '../../app/preferences';
import { Checkbox } from '../../components/ui/Checkbox';
import { Popover } from '../../components/ui/Popover';

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
  const last = columns.length === 1;
  return (
    <Popover
      label="Column options"
      trigger={`Columns (${columns.length})`}
      triggerClassName="flex h-10 items-center rounded-control border border-control-border bg-surface px-3 text-sm font-medium text-ink hover:border-ink"
      panelClassName="w-56 p-3"
    >
      <p className="mb-2 text-xs text-ink-soft">Seller is always shown.</p>
      <div className="flex flex-col gap-2.5">
        {OPTIONS.map((option) => {
          const checked = columns.includes(option.id);
          return (
            <Checkbox
              key={option.id}
              id={`seller-column-${option.id}`}
              label={option.label}
              checked={checked}
              // The last remaining column is disabled rather than silently
              // ignored: a checkbox that does nothing when clicked reads as
              // broken, where a disabled one plus the note below reads as a rule.
              disabled={checked && last}
              onChange={(event) => {
                if (event.target.checked) onChange([...columns, option.id]);
                else if (!last) onChange(columns.filter((column) => column !== option.id));
              }}
            />
          );
        })}
      </div>
      <p className="mt-2 text-xs text-ink-soft">
        {last ? 'At least one context column stays visible.' : 'Keep at least one visible.'}
      </p>
    </Popover>
  );
}
