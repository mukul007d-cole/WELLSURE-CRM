import type { ReactNode } from 'react';
import { RingAvatar } from '../../components/ui/RingAvatar';
import { StatusPill } from '../../components/ui/StatusPill';
import type { LeadShare, Seller360Record } from '../../types/domain';

/**
 * The identity rail.
 *
 * Sticky on wide screens so the record you're reading about stays on screen
 * while the timeline scrolls — the thing that makes a record page feel like one
 * object rather than a stack of cards.
 */
export function RecordSummaryPanel({
  seller,
  shares,
  actions,
}: {
  seller: Seller360Record;
  shares: LeadShare[];
  actions: ReactNode;
}) {
  return (
    <aside
      aria-label="Seller summary"
      className="flex flex-col gap-5 rounded-card border border-line bg-surface p-5 shadow-[var(--shadow-card)] lg:sticky lg:top-4 lg:self-start"
    >
      <div className="flex items-start gap-3">
        <RingAvatar name={seller.name} size={48} />
        <div className="min-w-0">
          <h2 className="truncate font-display text-lg font-bold text-ink">{seller.name}</h2>
          <p className="mt-0.5 truncate text-sm text-ink-soft">{seller.phone || 'No phone'}</p>
          {seller.email ? (
            <a
              href={`mailto:${seller.email}`}
              className="mt-0.5 block truncate text-sm text-ink-soft underline decoration-line-strong underline-offset-2 hover:text-ink"
            >
              {seller.email}
            </a>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">{actions}</div>

      <div className="border-t border-line-soft pt-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-soft">
          Journeys
        </h3>
        {seller.processInstances.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">No visible journeys.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {seller.processInstances.map((process) => (
              <li key={process.processInstanceId} className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-ink">{process.journey.name}</span>
                <StatusPill
                  name={process.currentStatus.name}
                  outcomeType={process.currentStatus.outcomeType}
                  behaviorType={process.currentStatus.behaviorType}
                />
                <span className="text-xs text-ink-soft">
                  {process.assignments.length > 0
                    ? process.assignments
                        .map((a) => `${a.userName} (${a.assignmentType})`)
                        .join(', ')
                    : 'No one assigned'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {shares.length > 0 ? (
        <div className="border-t border-line-soft pt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-soft">
            Shared with
          </h3>
          <ul className="mt-2 flex flex-col gap-1">
            {shares.map((share) => (
              <li key={share.id} className="text-sm text-ink-muted">
                {share.userName}
                <span className="text-ink-soft"> · {share.capabilities.join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
