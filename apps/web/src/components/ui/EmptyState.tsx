import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}

function DefaultRingIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <circle cx="20" cy="20" r="17.5" stroke="var(--color-gold)" strokeWidth="2.5" />
      <circle cx="20" cy="20" r="6" fill="var(--color-ink)" />
    </svg>
  );
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gold-soft/40">
        {icon ?? <DefaultRingIcon />}
      </span>
      <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
      <p className="max-w-sm text-sm text-ink-soft">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
