import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface BannerProps {
  tone: 'error' | 'info' | 'success';
  children: ReactNode;
}

const TONE_CLASSES: Record<BannerProps['tone'], string> = {
  error: 'bg-status-lost-bg text-status-lost border-status-lost/20',
  info: 'bg-status-followup-bg text-status-followup border-status-followup/20',
  success: 'bg-status-won-bg text-status-won border-status-won/20',
};

export function Banner({ tone, children }: BannerProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-control border px-4 py-3 text-sm', TONE_CLASSES[tone])}
    >
      {children}
    </div>
  );
}
