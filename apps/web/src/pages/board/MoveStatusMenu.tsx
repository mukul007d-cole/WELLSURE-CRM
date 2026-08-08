import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { statusTone, STATUS_TONE_VAR } from '../../components/ui/status-tone';
import type { Status } from '../../types/domain';

/**
 * The dependency-free path for moving a card.
 *
 * Dragging is great with a mouse and poor everywhere else: a horizontally
 * scrolling board is awkward on touch, and pointer dragging is unusable by
 * keyboard. This menu drives the identical mutation, so every user has a
 * working route to the same behavior.
 */
export function MoveStatusMenu({
  statuses,
  currentStatusId,
  onSelect,
  accessibleName,
}: {
  statuses: Status[];
  currentStatusId: string;
  onSelect: (status: Status) => void;
  /** Reads as "Move Acme Ltd" to assistive tech; the button shows just "Move". */
  accessibleName: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const targets = statuses.filter((status) => status.id !== currentStatusId);
  if (targets.length === 0) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={accessibleName}
        className="rounded-control px-2 py-1 text-xs font-medium text-ink-soft transition-colors hover:bg-paper hover:text-ink"
      >
        Move
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <ul
            role="listbox"
            aria-label="Move to status"
            className="absolute right-0 z-20 mt-1 max-h-64 w-56 overflow-y-auto rounded-control border border-line bg-surface py-1 shadow-[var(--shadow-popover)]"
          >
            {targets.map((status) => {
              const tone = statusTone(status.outcomeType, status.behaviorType);
              return (
                <li key={status.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => {
                      setOpen(false);
                      onSelect(status);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-paper',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: STATUS_TONE_VAR[tone] }}
                    />
                    <span className="truncate">{status.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}
