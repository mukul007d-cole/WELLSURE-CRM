import { StatusPill } from '../../components/ui/StatusPill';
import { Skeleton } from '../../components/ui/Skeleton';
import { STATUS_TONE_BG_VAR, STATUS_TONE_VAR, statusTone } from '../../components/ui/status-tone';
import type { OutcomeType, Status } from '../../types/domain';

export interface StatusCount {
  status: Status;
  count: number | undefined;
}

/**
 * Outcome is a fixed engine enum, not configuration, so grouping by it is safe.
 * The status names inside each group are always the configured ones.
 */
const OUTCOME_GROUPS: { outcome: OutcomeType; label: string }[] = [
  { outcome: 'open', label: 'Open' },
  { outcome: 'closed_won', label: 'Won' },
  { outcome: 'closed_lost', label: 'Lost' },
];

const ROW_HEIGHT = 26;
const BAR_HEIGHT = 12;

function GroupChart({ rows }: { rows: StatusCount[] }) {
  // Bars are drawn as percentage widths, so the SVG needs no viewBox and no
  // measurement — it just reflows with its container.
  const max = Math.max(1, ...rows.map((row) => row.count ?? 0));

  return (
    <div>
      <svg
        width="100%"
        height={rows.length * ROW_HEIGHT}
        // The numbers are rendered as real text beside this, so the drawing
        // itself carries no information a screen reader needs.
        aria-hidden="true"
        role="presentation"
        className="block"
      >
        {rows.map((row, index) => {
          const tone = statusTone(row.status.outcomeType, row.status.behaviorType);
          const y = index * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;
          const width = ((row.count ?? 0) / max) * 100;
          return (
            <g key={row.status.id}>
              <rect
                x="0"
                y={y}
                width="100%"
                height={BAR_HEIGHT}
                rx={BAR_HEIGHT / 2}
                fill={STATUS_TONE_BG_VAR[tone]}
              />
              {width > 0 ? (
                <rect
                  x="0"
                  y={y}
                  width={`${width}%`}
                  height={BAR_HEIGHT}
                  rx={BAR_HEIGHT / 2}
                  fill={STATUS_TONE_VAR[tone]}
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      <dl className="mt-2 space-y-1.5">
        {rows.map((row) => (
          <div key={row.status.id} className="flex items-center justify-between gap-3">
            <dt className="min-w-0">
              <StatusPill
                name={row.status.name}
                outcomeType={row.status.outcomeType}
                behaviorType={row.status.behaviorType}
              />
            </dt>
            <dd className="font-display text-sm font-semibold tabular-nums text-ink">
              {row.count === undefined ? <Skeleton className="h-4 w-8" /> : row.count}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function StatusDistributionChart({ rows }: { rows: StatusCount[] }) {
  const groups = OUTCOME_GROUPS.map((group) => ({
    ...group,
    rows: rows.filter((row) => row.status.outcomeType === group.outcome),
  })).filter((group) => group.rows.length > 0);

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map((group) => (
        <section key={group.outcome}>
          <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-[0.08em] text-ink-soft">
            {group.label}
          </h3>
          <GroupChart rows={group.rows} />
        </section>
      ))}
    </div>
  );
}
