import { Banner } from '../../components/ui/Banner';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { Eyebrow, Heading } from '../../components/ui/Heading';
import type { ImportRunResult } from '../../types/domain';
import { groupErrors } from './import-state';

/** Step four: what actually happened, and what to do about what didn't. */
export function ResultStep({
  result,
  onStartOver,
}: {
  result: ImportRunResult;
  onStartOver: () => void;
}) {
  const groups = groupErrors(result.rows);

  return (
    <div className="flex flex-col gap-4">
      {result.committed ? (
        <Banner tone="success">
          {result.createdCount === 0
            ? 'Finished — no new leads were created.'
            : `Created ${result.createdCount} ${result.createdCount === 1 ? 'lead' : 'leads'} from ${result.fileName}.`}
        </Banner>
      ) : (
        <Banner tone="error">
          Nothing was created. You chose to stop if any row failed, and {result.rejectedCount}{' '}
          {result.rejectedCount === 1 ? 'row' : 'rows'} could not be imported. Fix the rows listed
          below and upload the file again.
        </Banner>
      )}

      <Card>
        <CardHeader title="Summary" description={result.fileName} />
        <CardBody className="grid gap-4 sm:grid-cols-4">
          {[
            ['Rows in file', result.rowCount],
            ['Created', result.createdCount],
            ['Skipped as duplicates', result.skippedCount],
            ['Not imported', result.rejectedCount],
          ].map(([label, count]) => (
            <div key={label}>
              <Heading level="page" as="p" className="tabular-nums">
                {count}
              </Heading>
              <Eyebrow>{label}</Eyebrow>
            </div>
          ))}
        </CardBody>
      </Card>

      {result.skippedCount > 0 ? (
        <p className="text-sm text-ink-soft">
          Skipped rows already matched an existing lead under the duplicate rules you chose. They
          were not created and nothing existing was changed.
        </p>
      ) : null}

      {groups.length > 0 ? (
        <Card>
          <CardHeader
            title="Rows that were not imported"
            description="These were left alone. Correct them in the file and import just those rows."
          />
          <CardBody className="flex flex-col gap-2">
            {groups.map((group) => (
              <div
                key={group.reason}
                className="rounded-control border border-line bg-surface-sunken/60 px-3 py-2"
              >
                <p className="text-sm font-medium text-ink">{group.reason}</p>
                <p className="mt-1 text-xs text-ink-soft">
                  {group.rows.length === 1 ? 'Row ' : 'Rows '}
                  {group.rows
                    .slice(0, 40)
                    .map((row) => row.rowNumber)
                    .join(', ')}
                  {group.rows.length > 40 ? `, and ${group.rows.length - 40} more` : ''}
                </p>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <ButtonLink to="/sellers">View sellers</ButtonLink>
        <Button type="button" variant="secondary" onClick={onStartOver}>
          Import another file
        </Button>
      </div>
    </div>
  );
}
