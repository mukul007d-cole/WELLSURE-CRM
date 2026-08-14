import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Heading } from './Heading';

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Rendered right-aligned under the body — usually Buttons. */
  footer?: ReactNode;
  className?: string;
}

/**
 * Modal shell: labelled, Esc-closable, and focused on open so a keyboard user
 * lands inside it rather than back at the top of the page.
 */
export function Dialog({ title, onClose, children, footer, className }: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={`Close ${title}`}
        className="absolute inset-0 bg-ink/50"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative z-10 w-full max-w-lg rounded-card border border-line bg-surface p-5 shadow-[var(--shadow-popover)]',
          className,
        )}
      >
        <Heading level="section" as="h2" id={titleId}>
          {title}
        </Heading>
        <div className="mt-3 text-sm text-ink-soft">{children}</div>
        {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}
