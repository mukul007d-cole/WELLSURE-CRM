interface SpinnerProps {
  size?: number;
  tone?: 'gold' | 'ink';
  label?: string;
}

/**
 * A ring-stroke spinner — a nod to the badge ring in the logo mark rather
 * than a generic browser spinner. Respects prefers-reduced-motion via the
 * `motion-reduce:animate-none` utility (falls back to a static ring).
 */
export function Spinner({ size = 20, tone = 'gold', label = 'Loading' }: SpinnerProps) {
  const color = tone === 'gold' ? 'var(--color-gold)' : 'var(--color-ink)';
  return (
    <svg
      role="status"
      aria-label={label}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="motion-safe:animate-spin"
    >
      <circle cx="12" cy="12" r="9.5" stroke={color} strokeOpacity="0.2" strokeWidth="3" />
      <path
        d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
