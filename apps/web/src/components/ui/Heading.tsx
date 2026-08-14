import type { ElementType, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * A heading is a level, not a pile of utility classes.
 *
 * Four unrelated treatments had grown up independently — the page header at
 * `text-2xl font-bold tracking-tight`, the login title at `text-xl font-bold
 * tracking-wide`, the dialog at `text-lg font-bold`, the empty state at
 * `text-lg font-semibold` — so the same structural rank looked different
 * depending on which screen you were on. Picking a level here picks size,
 * weight and tracking together, from the scale in `theme.css`.
 *
 * `level` is the visual rank; `as` is the semantic element. They are separate
 * because a dialog title is an `h2` in the document and a `title` visually, and
 * forcing them to agree is how heading order ends up wrong for screen readers.
 */
export type HeadingLevel = 'display' | 'page' | 'section' | 'subsection';

const LEVEL_CLASSES: Record<HeadingLevel, string> = {
  display: 'font-display text-display font-bold text-ink',
  page: 'font-display text-title-lg font-bold text-ink',
  section: 'font-display text-title font-bold text-ink',
  subsection: 'font-display text-title-sm font-semibold text-ink',
};

const DEFAULT_ELEMENT: Record<HeadingLevel, ElementType> = {
  display: 'h1',
  page: 'h2',
  section: 'h3',
  subsection: 'h4',
};

export function Heading({
  level = 'section',
  as,
  className,
  children,
  ...props
}: {
  level?: HeadingLevel;
  as?: ElementType;
  className?: string;
  children: ReactNode;
  id?: string;
}) {
  const Element = as ?? DEFAULT_ELEMENT[level];
  return (
    <Element className={cn(LEVEL_CLASSES[level], className)} {...props}>
      {children}
    </Element>
  );
}

/**
 * The small-caps label above a group of things.
 *
 * Table column heads, sidebar group labels, the label side of a summary pair,
 * form section headers — all the same element, previously written out at four
 * sizes and four letter-spacings. `text-eyebrow` carries size, weight and
 * tracking from one token.
 *
 * `tone` exists because this appears on the dark sidebar as well as on paper,
 * and `text-ink-soft` is illegible there.
 */
export function Eyebrow({
  as: Element = 'p',
  tone = 'default',
  className,
  children,
  ...props
}: {
  as?: ElementType;
  tone?: 'default' | 'onInk';
  className?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <Element
      className={cn(
        'text-eyebrow uppercase',
        tone === 'onInk' ? 'text-on-ink-soft' : 'text-ink-soft',
        className,
      )}
      {...props}
    >
      {children}
    </Element>
  );
}
