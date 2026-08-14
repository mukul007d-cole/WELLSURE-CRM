import { useState } from 'react';
import { Banner } from '../../components/ui/Banner';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { DataCell, DataRow, DataTable } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/EmptyState';
import { Eyebrow } from '../../components/ui/Heading';
import { cn } from '../../lib/cn';
import type { ImportRowOutcome, ImportRunResult } from '../../types/domain';
import { groupErrors, outcomeCounts } from './import-state';

type Filter = 'all' | ImportRowOutcome['outcome'];

const TONE_CLASSES = {
  won: 'border-status-won/25 bg-status-won-bg text-status-won',
  open: 'border-status-open/25 bg-status-open-bg text-status-open',
  lost: 'border-status-lost/25 bg-status-lost-bg text-status-lost',
} as const;

/**
 * Step three: what would happen, numbers first.
 *
 * The three counts lead because they are the decision — an admin approving a
 * 4,000-row import is deciding "3,912 created, 71 skipped, 17 rejected: yes or
 * no", not reading rows. The counts are also the filter, so going from the
 * number to the rows behind it is one click rather than a scroll.
 *
 * Errors are grouped by reason before they are listed, because 300 rejections
 * are usually six problems.
 */
export function PreviewStep({ result }: { result: ImportRunResult }) {
  const [filter, setFilter] = useState<Filter>('all');
  const counts = outcomeCounts(result);
  const groups = groupErrors(result.rows);
  const rows = filter === 'all' ? result.rows : result.rows.filter((row) => row.outcome === filter);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {counts.map((entry) => {
          const active = filter === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(active ? 'all' : entry.id)}
              className={cn(
                'flex flex-col items-start gap-1 rounded-card border p-(--space-panel) text-left transition-shadow',
                TONE_CLASSES[entry.tone],
                active
                  ? 'shadow-[var(--shadow-raised)] ring-2 ring-ink/10'
                  : 'hover:shadow-[var(--shadow-raised)]',
              )}
            >
              <span className="font-display text-display font-bold tabular-nums">
                {entry.count}
              </span>
              <Eyebrow as="span" className="text-current opacity-80">
                {entry.label}
              </Eyebrow>
            </button>
          );
        })}
      </div>

      {result.rejectedCount === 0 && result.rowCount > 0 ? (
        <Banner tone="success">
          Every row in this file can be imported. Nothing has been created yet.
        </Banner>
      ) : null}

      {groups.length > 0 ? (
        <Card>
          <CardHeader
            title="Why rows were rejected"
            description="Fix these in the file and upload it again — or continue, and import the rest."
          />
          <CardBody className="flex flex-col gap-2">
            {groups.map((group) => (
              <details
                key={group.reason}
                className="rounded-control border border-line bg-surface-sunken/60 px-3 py-2"
              >
                <summary className="cursor-pointer text-sm text-ink marker:text-ink-soft">
                  <span className="font-medium">{group.reason}</span>
                  <span className="text-ink-soft">
                    {' '}
                    — {group.rows.length} {group.rows.length === 1 ? 'row' : 'rows'}
                  </span>
                </summary>
                <p className="mt-2 text-xs text-ink-soft">
                  {group.rows.length === 1 ? 'Row ' : 'Rows '}
                  {group.rows
                    .slice(0, 40)
                    .map((row) => row.rowNumber)
                    .join(', ')}
                  {group.rows.length > 40 ? `, and ${group.rows.length - 40} more` : ''}
                </p>
              </details>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Row by row"
          description={
            filter === 'all'
              ? `All ${result.rowCount} rows.`
              : `${rows.length} of ${result.rowCount} rows — select the same number again to clear the filter.`
          }
        />
        {rows.length === 0 ? (
          <EmptyState
            title="No rows in this group"
            description="Choose a different number above to see the rows behind it."
          />
        ) : (
          <DataTable
            headers={[{ label: 'Row', width: '5rem' }, 'Outcome', 'Detail']}
            caption="What each row of the file would do"
            maxHeightClass="max-h-[28rem]"
          >
            {rows.slice(0, 500).map((row) => (
              <DataRow key={row.rowNumber}>
                <DataCell primary>{row.rowNumber}</DataCell>
                <DataCell>{OUTCOME_LABEL[row.outcome]}</DataCell>
                <DataCell>{detailFor(row)}</DataCell>
              </DataRow>
            ))}
          </DataTable>
        )}
        {rows.length > 500 ? (
          <div className="border-t border-line px-(--space-panel) py-2 text-xs text-ink-soft">
            Showing the first 500 of {rows.length} rows.
          </div>
        ) : null}
      </Card>
    </div>
  );
}

const OUTCOME_LABEL: Record<ImportRowOutcome['outcome'], string> = {
  created: 'Will be created',
  skipped_duplicate: 'Duplicate — skipped',
  rejected: 'Cannot be imported',
};

function detailFor(row: ImportRowOutcome): string {
  if (row.outcome === 'rejected') return row.reason ?? '—';
  if (row.outcome === 'skipped_duplicate') {
    return row.matchedLeadName !== null && row.matchedLeadName !== undefined
      ? `Matches ${row.matchedLeadName}`
      : // Matching runs across the whole organization so no real duplicate slips
        // through, but a record outside this user's access is never named.
        'Matches an existing record you do not have access to';
  }
  return '—';
}
