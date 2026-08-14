import type { ReactNode } from 'react';
import { Eyebrow } from '../../components/ui/Heading';
import { RingAvatar } from '../../components/ui/RingAvatar';
import { StatusPill } from '../../components/ui/StatusPill';
import type { LeadShare, Seller360Record } from '../../types/domain';

/** Copy-to-clipboard, call and WhatsApp, straight off the number. */
function ContactActions({ phone }: { phone: string }) {
  const digits = phone.replace(/[^\d]/g, '');
  return (
    <span className="mt-1 flex items-center gap-1.5">
      <button
        type="button"
        aria-label="Copy phone number"
        title="Copy phone number"
        onClick={() => void navigator.clipboard?.writeText(phone)}
        className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink"
      >
        Copy
      </button>
      <a
        href={`tel:${digits}`}
        className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink"
      >
        Call
      </a>
      <a
        href={`https://wa.me/${digits}`}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink"
      >
        WhatsApp
      </a>
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Eyebrow as="dt" className="font-normal">
        {label}
      </Eyebrow>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  );
}

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
  repeatCount,
  actions,
}: {
  seller: Seller360Record;
  shares: LeadShare[];
  repeatCount: number;
  actions: ReactNode;
}) {
  // The first current assignment is the closest thing to an owner; assignment
  // types are configurable, so no particular one is privileged.
  const owner = seller.processInstances[0]?.assignments[0];
  const date = (value: string | undefined) => (value ? new Date(value).toLocaleDateString() : '—');
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
          {seller.phone ? <ContactActions phone={seller.phone} /> : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">{actions}</div>

      {/*
        Only facts with something behind them. The reference layout also carries
        Communication Status, Recent Followup and Lead Source; this system has
        no telephony, no tasks API and no source column, so those are left out
        rather than shown as a permanent "N/A".
      */}
      <dl className="grid grid-cols-2 gap-3 border-t border-line-soft pt-4">
        <Stat label="Owner" value={owner ? owner.userName : 'Unassigned'} />
        <Stat label="Repeat count" value={String(repeatCount)} />
        <Stat label="Added on" value={date(seller.createdAt)} />
        <Stat label="Updated on" value={date(seller.updatedAt)} />
      </dl>

      <div className="border-t border-line-soft pt-4">
        <Eyebrow as="h3">Journeys</Eyebrow>
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
          <Eyebrow as="h3">Shared with</Eyebrow>
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
