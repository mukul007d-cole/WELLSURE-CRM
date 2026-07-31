import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, className, id, ...props },
  ref,
) {
  return (
    <label
      htmlFor={id}
      className={cn('inline-flex cursor-pointer items-center gap-2 text-sm text-ink', className)}
    >
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className="h-4 w-4 rounded-[4px] border border-line-strong text-gold accent-[var(--color-gold)]"
        {...props}
      />
      {label}
    </label>
  );
});
