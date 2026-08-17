import type { Journey } from '../../types/domain';
import { cn } from '../../lib/cn';

interface JourneyTabsProps {
  journeys: Journey[];
  activeJourneyId: string | undefined;
  onSelect: (journeyId: string | undefined) => void;
  /**
   * The Seller List and Dashboard can show every journey at once; the board
   * can't, because its columns are the statuses of one specific journey.
   */
  allowAll?: boolean;
}

export function JourneyTabs({
  journeys,
  activeJourneyId,
  onSelect,
  allowAll = true,
}: JourneyTabsProps) {
  return (
    <div role="tablist" aria-label="Journey" className="flex gap-1 overflow-x-auto px-4 sm:px-6">
      {allowAll ? (
        <TabButton active={!activeJourneyId} onClick={() => onSelect(undefined)}>
          All journeys
        </TabButton>
      ) : null}
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
          ? 'border-gold-foreground text-ink'
          : 'border-transparent text-ink-soft hover:border-line-strong hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
