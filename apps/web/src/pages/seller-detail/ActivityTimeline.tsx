import { Banner } from '../../components/ui/Banner';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { ApiError, friendlyErrorMessage } from '../../lib/api-error';
import type { ActivityEntry, AdminUser, FieldDefinition, Status } from '../../types/domain';
import { TimelineEntry } from './TimelineEntry';

export function ActivityTimeline({
  entries,
  fields,
  statuses,
  directory,
  isPending,
  error,
  composer,
}: {
  entries: ActivityEntry[];
  fields: readonly FieldDefinition[];
  statuses: readonly Status[];
  /** Used to name the two sides of a reassignment; empty without users:view. */
  directory: readonly AdminUser[];
  isPending: boolean;
  error: unknown;
  composer?: React.ReactNode;
}) {
  const names = new Map(directory.map((user) => [user.id, user.name]));
  if (error) {
    // A 403 here is a role boundary, not a fault — say which.
    const forbidden = error instanceof ApiError && error.status === 403;
    return forbidden ? (
      <EmptyState
        title="History isn’t visible to your role"
        description="You can see this seller, but not the record of changes made to it."
      />
    ) : (
      <Banner tone="error">{friendlyErrorMessage(error)}</Banner>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {composer}
      {isPending ? (
        <div className="flex flex-col gap-4" role="status" aria-label="Loading activity">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          title="Nothing recorded yet"
          description="Edits, status moves, comments and reassignments show up here."
        />
      ) : (
        <ol className="flex flex-col">
          {entries.map((entry) => (
            <TimelineEntry
              key={entry.id}
              entry={entry}
              fields={fields}
              statuses={statuses}
              directory={names}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
