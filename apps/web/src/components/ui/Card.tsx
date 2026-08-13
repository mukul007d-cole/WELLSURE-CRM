import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Heading } from './Heading';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-card border border-line bg-surface shadow-[var(--shadow-card)]',
        className,
      )}
      {...props}
    />
  );
}

/**
 * One padding rhythm for panel interiors.
 *
 * Card padding was `p-3`, `p-4`, `p-5` and `p-6` across about thirty call sites
 * with nothing choosing between them, which is the kind of drift that reads as
 * carelessness long before anyone can name it. These three spend
 * `--space-panel` instead.
 *
 * Existing `<Card className="p-4">` call sites keep working untouched — this is
 * what new surfaces reach for, and what the rest migrates to when it is next
 * edited, rather than a rewrite of every page.
 */
export function CardHeader({
  title,
  description,
  actions,
  className,
  children,
}: {
  /** Rendered as a section heading. Omit and pass `children` for custom content. */
  title?: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-line px-(--space-panel) py-(--space-panel-tight)',
        className,
      )}
    >
      {children ?? (
        <div className="min-w-0">
          {title ? <Heading level="subsection">{title}</Heading> : null}
          {description ? <p className="mt-0.5 text-sm text-ink-soft">{description}</p> : null}
        </div>
      )}
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-(--space-panel)', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-sunken px-(--space-panel) py-(--space-panel-tight)',
        className,
      )}
      {...props}
    />
  );
}
