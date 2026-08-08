import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '../../lib/cn';

/**
 * One page frame for every surface.
 *
 * Before this each page hand-rolled its own heading block and filter row, so
 * spacing, type scale and control placement drifted from screen to screen —
 * which is most of what makes an app feel assembled rather than designed.
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {breadcrumb ? <div className="mb-1">{breadcrumb}</div> : null}
        <h2 className="font-display text-2xl font-bold tracking-tight text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-ink-soft">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * A filter/search strip. Sits directly above the content it filters and reads
 * as one unit with it, rather than floating as loose controls on the page.
 */
export function Toolbar({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface px-3 py-2.5">
      {children}
      {trailing ? <div className="ml-auto flex items-center gap-2">{trailing}</div> : null}
    </div>
  );
}

/** Count//state line for a filtered collection — "12 of 40 sellers". */
export function ResultSummary({ children }: { children: ReactNode }) {
  return <p className="text-xs text-ink-soft">{children}</p>;
}

/** A titled content block. Replaces ad-hoc Card + heading pairs. */
export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'rounded-card border border-line bg-surface shadow-[var(--shadow-card)]',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <h3 className="font-display text-base font-bold text-ink">{title}</h3>
          {description ? <p className="mt-0.5 text-sm text-ink-soft">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

/** Standard page padding + vertical rhythm, so every route lines up. */
export function PageBody({ children }: { children: ReactNode }) {
  return <div className="space-y-5 p-4 sm:p-6">{children}</div>;
}

export interface SubNavItem {
  label: string;
  to: string;
}

/**
 * Tabs for sub-sections of one area — e.g. the directory and the reporting
 * tree are both "user management", not two unrelated sidebar entries.
 */
export function SubNav({ items }: { items: SubNavItem[] }) {
  return (
    <nav className="flex gap-1 border-b border-line" aria-label="Section">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end
          className={({ isActive }) =>
            cn(
              'whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'border-gold text-ink'
                : 'border-transparent text-ink-soft hover:border-line-strong hover:text-ink',
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
