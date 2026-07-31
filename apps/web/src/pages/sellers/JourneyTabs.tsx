import type { Journey } from '../../types/domain';
import { cn } from '../../lib/cn';

interface JourneyTabsProps {
  journeys: Journey[];
  activeJourneyId: string | undefined;
  onSelect: (journeyId: string | undefined) => void;
}

export function JourneyTabs({ journeys, activeJourneyId, onSelect }: JourneyTabsProps) {
  return (
    <div role="tablist" aria-label="Journey" className="flex gap-1 overflow-x-auto px-4 sm:px-6">
      <TabButton active={!activeJourneyId} onClick={() => onSelect(undefined)}>
        All journeys
      </TabButton>
      {journeys.map((journey) => (
        <TabButton
          key={journey.id}
          active={activeJourneyId === journey.id}
          onClick={() => onSelect(journey.id)}
        >
          {journey.name}
        </TabButton>
      ))}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors',
        active
          ? 'border-gold text-ink'
          : 'border-transparent text-ink-soft hover:border-line-strong hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
