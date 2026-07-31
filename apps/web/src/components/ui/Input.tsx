import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-10 w-full rounded-control border bg-surface px-3 text-sm text-ink placeholder:text-ink-soft',
        'transition-colors',
        invalid ? 'border-status-lost' : 'border-line-strong hover:border-ink-soft',
        'disabled:cursor-not-allowed disabled:bg-paper disabled:text-ink-soft',
        className,
      )}
      {...props}
    />
  );
});
