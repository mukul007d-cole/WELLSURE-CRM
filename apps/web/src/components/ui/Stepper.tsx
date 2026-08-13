import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Progress through a multi-step flow.
 *
 * Built as a shared primitive rather than inline in the import wizard, because
 * a rail like this is exactly the thing the next multi-step surface would
 * otherwise reinvent — which is how the four heading treatments happened.
 *
 * Three states, and they are visually distinct without relying on colour alone:
 * a done step carries a check, the current step carries a filled marker and a
 * heavier label, and an upcoming step is outlined and muted. `aria-current`
 * carries the same information to assistive tech.
 */
export interface Step<Id extends string> {
  id: Id;
  label: string;
  /** Shown under the label on the current step — "47 columns", "3 errors". */
  detail?: ReactNode;
}

export function Stepper<Id extends string>({
  steps,
  current,
  completed,
  onSelect,
  label = 'Progress',
  className,
}: {
  steps: readonly Step<Id>[];
  current: Id;
  /** Steps already finished. Passed explicitly rather than inferred from order,
   *  so a flow that lets you go back does not claim later steps are done. */
  completed: readonly Id[];
  /** Provided only for steps that can be returned to; others render inert. */
  onSelect?: (id: Id) => void;
  label?: string;
  className?: string;
}) {
  const done = new Set(completed);
  return (
    <nav aria-label={label} className={className}>
      <ol className="flex flex-wrap items-center gap-1">
        {steps.map((step, index) => {
          const isCurrent = step.id === current;
          const isDone = done.has(step.id) && !isCurrent;
          const reachable = isDone && onSelect !== undefined;
          const content = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[0.6875rem] font-semibold transition-colors',
                  isCurrent && 'border-gold bg-gold text-ink',
                  isDone && 'border-gold-deep bg-gold-soft text-ink',
                  !isCurrent && !isDone && 'border-line-strong bg-surface text-ink-soft',
                )}
              >
                {isDone ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="m2.5 6.5 2.5 2.5 4.5-5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <span className="flex min-w-0 flex-col">
                <span
                  className={cn(
                    'truncate text-sm',
                    isCurrent ? 'font-semibold text-ink' : 'font-medium text-ink-soft',
                  )}
                >
                  {step.label}
                </span>
                {isCurrent && step.detail ? (
                  <span className="truncate text-xs text-ink-soft">{step.detail}</span>
                ) : null}
              </span>
            </>
          );
          return (
            <li key={step.id} className="flex items-center gap-1">
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-px w-6 sm:w-10',
                    isDone || isCurrent ? 'bg-gold-deep' : 'bg-line',
                  )}
                />
              ) : null}
              {reachable ? (
                <button
                  type="button"
                  onClick={() => onSelect(step.id)}
                  className="flex items-center gap-2 rounded-control px-2 py-1.5 transition-colors hover:bg-surface-hover"
                >
                  {content}
                </button>
              ) : (
                <span
                  {...(isCurrent ? { 'aria-current': 'step' as const } : {})}
                  className="flex items-center gap-2 px-2 py-1.5"
                >
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
