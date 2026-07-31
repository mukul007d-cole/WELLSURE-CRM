import { forwardRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, rows = 4, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full rounded-control border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-soft',
        'transition-colors resize-y',
        invalid ? 'border-status-lost' : 'border-line-strong hover:border-ink-soft',
        'disabled:cursor-not-allowed disabled:bg-paper disabled:text-ink-soft',
        className,
      )}
      {...props}
    />
  );
});
