import type { ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '../../lib/cn';

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  required?: boolean | undefined;
  children: (ids: { inputId: string; describedBy: string | undefined }) => ReactNode;
  className?: string | undefined;
  /** 'onInk' for fields placed on the dark brand surface (e.g. login) — text-ink is illegible there. */
  tone?: 'default' | 'onInk';
}

const TONE_CLASSES = {
  default: { label: 'text-ink', hint: 'text-ink-soft', error: 'text-status-lost' },
  onInk: { label: 'text-on-ink', hint: 'text-on-ink-soft', error: 'text-[#f0968d]' },
} as const;

export function Field({
  label,
  error,
  hint,
  required,
  children,
  className,
  tone = 'default',
}: FieldProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  const colors = TONE_CLASSES[tone];

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className={cn('text-sm font-medium', colors.label)}>
        {label}
        {required ? (
          <span className={cn('ml-0.5', colors.error)} aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children({ inputId, describedBy })}
      {error ? (
        <p id={errorId} className={cn('text-sm', colors.error)}>
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className={cn('text-sm', colors.hint)}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
