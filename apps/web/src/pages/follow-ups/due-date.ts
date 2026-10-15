const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const relative = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' });

/**
 * "in 3 days" / "2 hours ago" — the relative half of a due date. Picks the
 * largest unit that is at least one whole step, so a follow-up due tomorrow
 * reads as "tomorrow" rather than "in 22 hours".
 */
export function relativeDue(iso: string, now: number = Date.now()): string {
  const delta = Date.parse(iso) - now;
  const magnitude = Math.abs(delta);
  if (magnitude < MINUTE) return 'now';
  if (magnitude < HOUR) return relative.format(Math.round(delta / MINUTE), 'minute');
  if (magnitude < DAY) return relative.format(Math.round(delta / HOUR), 'hour');
  return relative.format(Math.round(delta / DAY), 'day');
}

/** The absolute half: date and time in the viewer's own zone. */
export function absoluteDue(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** `YYYY-MM-DDTHH:mm` in local time — the value a `datetime-local` input takes. */
export function toDateTimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * A sensible starting point for a reschedule: a day after the current due
 * time, or a day from now if that has already passed.
 */
export function defaultRescheduleAt(dueIso: string, now: number = Date.now()): string {
  const next = new Date(Math.max(Date.parse(dueIso), now) + DAY);
  next.setSeconds(0, 0);
  return toDateTimeLocal(next);
}
