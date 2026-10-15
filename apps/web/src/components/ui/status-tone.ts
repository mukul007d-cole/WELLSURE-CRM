import type { BehaviorType, OutcomeType, StatusColor } from '../../types/domain';

export type StatusTone = 'open' | 'won' | 'lost' | 'followup' | 'calllater' | 'archived';

/**
 * Color follows the fixed outcome/behavior enums, never the admin-defined
 * status name — so relabeling a status in config can't silently break its
 * color, and gold is never reachable here (status color is a separate
 * palette from the brand accent by construction).
 *
 * Shared by StatusPill, the board column headers, and the dashboard chart so
 * a status reads the same everywhere without any of them re-deriving color.
 */
export function statusTone(outcomeType: OutcomeType, behaviorType: BehaviorType): StatusTone {
  if (behaviorType === 'archived') return 'archived';
  if (outcomeType === 'closed_won') return 'won';
  if (outcomeType === 'closed_lost') return 'lost';
  if (behaviorType === 'follow_up') return 'followup';
  if (behaviorType === 'call_later') return 'calllater';
  return 'open';
}

export const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  open: 'text-status-open bg-status-open-bg',
  won: 'text-status-won bg-status-won-bg',
  lost: 'text-status-lost bg-status-lost-bg',
  followup: 'text-status-followup bg-status-followup-bg',
  calllater: 'text-status-calllater bg-status-calllater-bg',
  archived: 'text-status-archived bg-status-archived-bg',
};

/**
 * SVG `fill` can't use Tailwind's color utilities, so the chart reads the same
 * tokens through CSS variables rather than duplicating the hex values.
 */
export const STATUS_TONE_VAR: Record<StatusTone, string> = {
  open: 'var(--color-status-open)',
  won: 'var(--color-status-won)',
  lost: 'var(--color-status-lost)',
  followup: 'var(--color-status-followup)',
  calllater: 'var(--color-status-calllater)',
  archived: 'var(--color-status-archived)',
};

export const STATUS_TONE_BG_VAR: Record<StatusTone, string> = {
  open: 'var(--color-status-open-bg)',
  won: 'var(--color-status-won-bg)',
  lost: 'var(--color-status-lost-bg)',
  followup: 'var(--color-status-followup-bg)',
  calllater: 'var(--color-status-calllater-bg)',
  archived: 'var(--color-status-archived-bg)',
};

/**
 * ADR-0026 — an admin-chosen palette token on the status itself
 * (`statuses.color`, carried over from Cronberry's per-status colour). Same
 * discipline as the tones above: keyed by a closed token set mirrored from the
 * API, never by a status name. Tailwind's own palette rather than new theme
 * tokens, since these are deliberately many hues where the tones are six
 * meanings; each pair is the 700/800 ink on its 50/100 wash, which keeps the
 * pill's text at AA contrast on every one.
 */
export const STATUS_COLOR_CLASSES: Record<StatusColor, string> = {
  gray: 'text-gray-700 bg-gray-100',
  blue: 'text-blue-700 bg-blue-50',
  teal: 'text-teal-700 bg-teal-50',
  green: 'text-green-700 bg-green-50',
  lime: 'text-lime-800 bg-lime-100',
  amber: 'text-amber-800 bg-amber-50',
  orange: 'text-orange-700 bg-orange-50',
  red: 'text-red-700 bg-red-50',
  pink: 'text-pink-700 bg-pink-50',
  purple: 'text-purple-700 bg-purple-50',
  indigo: 'text-indigo-700 bg-indigo-50',
};

/**
 * The classes a status renders with: its configured colour when it has one,
 * otherwise the outcome/behavior tone exactly as before colours existed. A
 * token this client doesn't know yet (the API added one first) falls back to
 * the tone rather than rendering uncoloured.
 */
export function statusPillClasses(status: {
  outcomeType: OutcomeType;
  behaviorType: BehaviorType;
  color?: StatusColor | null | undefined;
}): string {
  const configured = status.color ? STATUS_COLOR_CLASSES[status.color] : undefined;
  return configured ?? STATUS_TONE_CLASSES[statusTone(status.outcomeType, status.behaviorType)];
}
