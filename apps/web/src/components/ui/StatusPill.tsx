import type { BehaviorType, OutcomeType } from '../../types/domain';
import { STATUS_TONE_CLASSES, statusTone } from './status-tone';

interface StatusPillProps {
  /** Admin-configured status name — always rendered verbatim, never hardcoded. */
  name: string;
  outcomeType: OutcomeType;
  behaviorType: BehaviorType;
}

export function StatusPill({ name, outcomeType, behaviorType }: StatusPillProps) {
  const tone = statusTone(outcomeType, behaviorType);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium ${STATUS_TONE_CLASSES[tone]}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {name}
    </span>
  );
}
