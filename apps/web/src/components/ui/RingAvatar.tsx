import { cn } from '../../lib/cn';

interface RingAvatarProps {
  name: string;
  size?: number;
  tone?: 'gold' | 'ink';
  className?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * A circular initials chip with a thin inset ring — the same badge-ring
 * motif as the logo mark, reused as a small recurring identity element
 * instead of a generic filled-circle avatar.
 */
export function RingAvatar({ name, size = 36, tone = 'gold', className }: RingAvatarProps) {
  const bg = tone === 'gold' ? 'bg-gold text-ink' : 'bg-ink text-on-ink';
  const ring = tone === 'gold' ? 'ring-ink/70' : 'ring-gold/80';

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-display font-semibold ring-2 ring-inset',
        bg,
        ring,
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
