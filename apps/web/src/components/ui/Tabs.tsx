import { useId, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface TabItem<Id extends string> {
  id: Id;
  label: string;
  /** Rendered after the label — a count, usually. */
  badge?: ReactNode;
}

/**
 * An in-page tab strip.
 *
 * Three copies of this markup had grown up separately (the journey switcher,
 * the seller record, and a route-driven one in PageFrame) and none of them
 * wired the panel side or the keyboard. A tablist that can't be driven with
 * arrow keys isn't a tablist to a screen-reader user — it's a row of buttons
 * that lies about being one.
 *
 * Route-driven section navigation stays with `SubNav`; this is for state.
 */
export function Tabs<Id extends string>({
  groupId,
  items,
  active,
  onChange,
  label,
  className,
}: {
  /** From `useTabGroup()`, shared with this strip's `TabPanel`s. */
  groupId: string;
  items: readonly TabItem<Id>[];
  active: Id;
  onChange: (id: Id) => void;
  /** Names the tablist for assistive tech, e.g. "Record sections". */
  label: string;
  className?: string;
}) {
  const refs = useRef(new Map<Id, HTMLButtonElement>());

  function focusTab(id: Id) {
    onChange(id);
    refs.current.get(id)?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const index = items.findIndex((item) => item.id === active);
    if (index < 0) return;
    const last = items.length - 1;
    // Wrapping movement, plus Home/End — the pattern users expect from a
    // tablist and the reason this exists as a component at all.
    const target =
      event.key === 'ArrowRight'
        ? items[index === last ? 0 : index + 1]
        : event.key === 'ArrowLeft'
          ? items[index === 0 ? last : index - 1]
          : event.key === 'Home'
            ? items[0]
            : event.key === 'End'
              ? items[last]
              : undefined;
    if (!target) return;
    event.preventDefault();
    focusTab(target.id);
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      // The strip itself is never a tab stop — the selected tab is, via the
      // roving tabindex below. -1 satisfies the rule without adding a stop.
      tabIndex={-1}
      className={cn('flex overflow-x-auto border-b border-line', className)}
    >
      {items.map((item) => {
        const selected = item.id === active;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={tabId(groupId, item.id)}
            aria-selected={selected}
            aria-controls={panelId(groupId, item.id)}
            // Roving tabindex: one stop for the whole strip, arrows move within.
            tabIndex={selected ? 0 : -1}
            ref={(node) => {
              if (node) refs.current.set(item.id, node);
              else refs.current.delete(item.id);
            }}
            onClick={() => onChange(item.id)}
            className={cn(
              'shrink-0 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              selected
                ? 'border-gold-foreground text-ink'
                : 'border-transparent text-ink-soft hover:border-line-strong hover:text-ink',
            )}
          >
            {item.label}
            {item.badge !== undefined && item.badge !== null ? (
              <span className="ml-1.5 rounded-pill bg-surface-sunken px-1.5 py-0.5 text-xs tabular-nums text-ink-soft">
                {item.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** The panel for one tab. Render only the active one. */
export function TabPanel<Id extends string>({
  groupId,
  id,
  children,
  className,
}: {
  groupId: string;
  id: Id;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tabpanel"
      id={panelId(groupId, id)}
      aria-labelledby={tabId(groupId, id)}
      tabIndex={0}
      className={className}
    >
      {children}
    </div>
  );
}

/**
 * Ties a strip to its panels. Both sides need the same generated prefix, and
 * `useId` can't be called twice and match.
 */
export function useTabGroup(): string {
  return useId();
}

const tabId = (group: string, id: string) => `${group}-tab-${id}`;
const panelId = (group: string, id: string) => `${group}-panel-${id}`;
