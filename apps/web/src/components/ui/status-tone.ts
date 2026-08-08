import type { BehaviorType, OutcomeType } from '../../types/domain';

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
