import type { BehaviorType, OutcomeType, StatusColor } from '../../types/domain';
import { statusPillClasses } from './status-tone';

interface StatusPillProps {
  /** Admin-configured status name — always rendered verbatim, never hardcoded. */
  name: string;
  outcomeType: OutcomeType;
  behaviorType: BehaviorType;
  /**
   * The status's configured palette token (ADR-0026), when the caller's
   * status shape carries one. Absent or null keeps the outcome/behavior tone.
   */
  color?: StatusColor | null | undefined;
}

export function StatusPill({ name, outcomeType, behaviorType, color }: StatusPillProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium ${statusPillClasses({ outcomeType, behaviorType, color })}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {name}
    </span>
  );
}
