import type { BehaviorType, OutcomeType } from '../../types/domain';

interface StatusPillProps {
  /** Admin-configured status name — always rendered verbatim, never hardcoded. */
  name: string;
  outcomeType: OutcomeType;
  behaviorType: BehaviorType;
}

type Tone = 'open' | 'won' | 'lost' | 'followup' | 'calllater' | 'archived';

/**
 * Color follows the fixed outcome/behavior enums, never the admin-defined
 * status name — so relabeling a status in config can't silently break its
 * color, and gold is never reachable here (status color is a separate
 * palette from the brand accent by construction).
 */
function toneFor(outcomeType: OutcomeType, behaviorType: BehaviorType): Tone {
  if (behaviorType === 'archived') return 'archived';
  if (outcomeType === 'closed_won') return 'won';
  if (outcomeType === 'closed_lost') return 'lost';
  if (behaviorType === 'follow_up') return 'followup';
  if (behaviorType === 'call_later') return 'calllater';
  return 'open';
}

const TONE_STYLES: Record<Tone, string> = {
  open: 'text-status-open bg-status-open-bg',
  won: 'text-status-won bg-status-won-bg',
  lost: 'text-status-lost bg-status-lost-bg',
  followup: 'text-status-followup bg-status-followup-bg',
  calllater: 'text-status-calllater bg-status-calllater-bg',
  archived: 'text-status-archived bg-status-archived-bg',
};

export function StatusPill({ name, outcomeType, behaviorType }: StatusPillProps) {
  const tone = toneFor(outcomeType, behaviorType);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium ${TONE_STYLES[tone]}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {name}
    </span>
  );
}
