import { useMemo, useState } from 'react';
import { Checkbox } from '../../../components/ui/Checkbox';
import { Input } from '../../../components/ui/Input';

export interface MultiSelectOption {
  id: string;
  name: string;
  /** Shown after the name, e.g. an email or "(hidden on this Journey)". */
  detail?: string | undefined;
}

/**
 * A checkbox list over a set of ids, with an optional search box.
 *
 * `SearchableSelect` is the single-choice version; the Journey editor needs
 * several "pick any number of these" controls (members, roles, Fields), and
 * every one of them is a full-replace save. So the list never drops an id it
 * cannot show: a selected id with no matching option stays selected and is
 * counted below the list, rather than vanishing from the next save because the
 * option behind it went inactive.
 */
export function CheckboxMultiSelect({
  legend,
  hint,
  options,
  value,
  onChange,
  disabled = false,
  searchLabel,
  loading = false,
  emptyText = 'Nothing to choose from.',
}: {
  legend: string;
  hint?: string | undefined;
  options: readonly MultiSelectOption[];
  value: readonly string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  /** Renders a search box with this accessible name. Omit for short lists. */
  searchLabel?: string | undefined;
  loading?: boolean;
  emptyText?: string;
}) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return options;
    return options.filter((option) =>
      `${option.name} ${option.detail ?? ''}`.toLowerCase().includes(term),
    );
  }, [options, search]);
  const unlisted = value.filter((id) => !options.some((option) => option.id === id)).length;
  const toggle = (id: string, checked: boolean) =>
    onChange(checked ? [...value.filter((v) => v !== id), id] : value.filter((v) => v !== id));
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-ink">
        {legend}
        <span className="ml-2 text-xs font-normal text-ink-soft">{value.length} selected</span>
      </legend>
      {hint ? <p className="text-xs text-ink-soft">{hint}</p> : null}
      {searchLabel ? (
        <Input
          aria-label={searchLabel}
          placeholder={searchLabel}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      ) : null}
      {loading ? (
        <p className="text-sm text-ink-soft">Loading…</p>
      ) : options.length === 0 ? (
        <p className="text-sm text-ink-soft">{emptyText}</p>
      ) : (
        <div className="grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2">
          {filtered.map((option) => (
            <Checkbox
              key={option.id}
              label={option.detail ? `${option.name} (${option.detail})` : option.name}
              disabled={disabled}
              checked={value.includes(option.id)}
              onChange={(event) => toggle(option.id, event.target.checked)}
            />
          ))}
        </div>
      )}
      {unlisted > 0 ? (
        <p className="text-xs text-ink-soft">
          Also keeps {unlisted} selection{unlisted === 1 ? '' : 's'} not listed here (inactive or no
          longer available).
        </p>
      ) : null}
    </fieldset>
  );
}
