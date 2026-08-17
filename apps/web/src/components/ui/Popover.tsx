import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * A menu or panel anchored to the control that opened it.
 *
 * Four of these had grown up separately — the profile menu, the help panel, the
 * mobile search sheet and the Seller List column manager — and between them they
 * implemented dismissal zero times. A panel you can only close by clicking the
 * same button again is a trap on a touch screen and a dead end for a keyboard
 * user, and the column manager (a bare `<details>`) could not be closed by Esc
 * at all.
 *
 * This is the same contract `Dialog` already honours, minus the modality:
 *
 * - **Esc closes**, and returns focus to the trigger, so a keyboard user is
 *   never stranded inside a panel they cannot see the edges of.
 * - **A click or focus outside closes**, which is what every user who has ever
 *   used a menu expects and none of the four did.
 * - `aria-expanded` and `aria-haspopup` on the trigger, and a named panel, so
 *   the relationship is in the accessibility tree rather than only on screen.
 *
 * Not modal: no focus trap and no inert background. These panels are
 * conveniences, and trapping focus in a three-checkbox popover would be worse
 * than the problem it solves. `Dialog` remains the modal one.
 *
 * There is deliberately no way for a child to close the panel. No current call
 * site needs one — a menu item either navigates or toggles a preference in
 * place — and the obvious API for it (a render prop handed a close callback)
 * reads a ref during render. If one is ever needed, context is the way to add
 * it without that.
 */
export function Popover({
  label,
  trigger,
  children,
  align = 'right',
  panelClassName,
  triggerClassName,
}: {
  /** Names the panel for assistive tech, e.g. "Column options". */
  label: string;
  /** Rendered inside the trigger button. */
  trigger: ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
  panelClassName?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    /*
     * `pointerdown`, not `click`: a `click` listener fires after the target has
     * already acted, so a click on a control *behind* the panel would run
     * against a panel that was still open, and on iOS a tap outside would need
     * two taps to register.
     */
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    // Tabbing out of the panel closes it too, so keyboard and pointer agree.
    const onFocusIn = (event: FocusEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open ? (
        <div
          role="group"
          /*
           * `aria-label` alone, not alongside `aria-labelledby`. Both were set
           * at first, and `aria-labelledby` silently wins — so the panel
           * announced the trigger's own text ("Columns (3)") instead of what it
           * contains. One labelling mechanism, the descriptive one.
           */
          aria-label={label}
          className={cn(
            'absolute z-30 mt-2 rounded-card border border-line bg-surface shadow-[var(--shadow-popover)]',
            align === 'right' ? 'right-0' : 'left-0',
            panelClassName,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
