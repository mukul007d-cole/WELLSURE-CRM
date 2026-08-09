import {
  entryCopy,
  fieldChanges,
  hasRedactedChanges,
  TONE_CLASSES,
} from '../../components/activity/entry-copy';
import { formatFieldValue } from '../../lib/format';
import { cn } from '../../lib/cn';
import type { ActivityEntry, FieldDefinition, Status } from '../../types/domain';

/** Absolute date in a title so hovering gives the exact time. */
function relativeTime(iso: string): { label: string; exact: string } {
  const then = new Date(iso);
  const exact = then.toLocaleString();
  const minutes = Math.round((Date.now() - then.getTime()) / 60_000);
  if (minutes < 1) return { label: 'just now', exact };
  if (minutes < 60) return { label: `${minutes}m ago`, exact };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { label: `${hours}h ago`, exact };
  const days = Math.round(hours / 24);
  if (days < 30) return { label: `${days}d ago`, exact };
  return { label: then.toLocaleDateString(), exact };
}

function statusName(statuses: readonly Status[], id: unknown): string | null {
  if (typeof id !== 'string') return null;
  return statuses.find((status) => status.id === id)?.name ?? null;
}

export function TimelineEntry({
  entry,
  fields,
  statuses,
}: {
  entry: ActivityEntry;
  fields: readonly FieldDefinition[];
  statuses: readonly Status[];
}) {
  const { verb, tone } = entryCopy(entry.actionType);
  const time = relativeTime(entry.timestamp);
  const changes = fieldChanges(entry, fields);
  const redacted = hasRedactedChanges(entry, changes);

  const oldStatus = statusName(
    statuses,
    (entry.oldValue as { statusId?: unknown } | null)?.statusId,
  );
  const newStatus = statusName(
    statuses,
    (entry.newValue as { statusId?: unknown } | null)?.statusId,
  );

  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {/* The rail. Decorative, so the list semantics stay clean. */}
      <span
        aria-hidden="true"
        className="absolute bottom-0 left-[15px] top-8 w-px bg-line-soft last:hidden"
      />
      <span
        aria-hidden="true"
        className={cn(
          'relative z-10 mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold',
          TONE_CLASSES[tone],
        )}
      >
        {(entry.actorName ?? 'S').slice(0, 1).toUpperCase()}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">
          <span className="font-medium">{entry.actorName ?? 'System'}</span> {verb}
          <span className="text-ink-soft"> · </span>
          <time dateTime={entry.timestamp} title={time.exact} className="text-xs text-ink-soft">
            {time.label}
          </time>
        </p>

        {entry.commentText ? (
          <p className="mt-1.5 whitespace-pre-wrap rounded-control bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
            {entry.commentText}
          </p>
        ) : null}

        {oldStatus || newStatus ? (
          <p className="mt-1 text-sm text-ink-muted">
            {oldStatus ? <span className="line-through text-ink-soft">{oldStatus}</span> : null}
            {oldStatus && newStatus ? <span aria-hidden="true"> → </span> : null}
            {newStatus}
          </p>
        ) : null}

        {changes.length > 0 ? (
          <ul className="mt-1.5 flex flex-col gap-1">
            {changes.map((change) => (
              <li key={change.fieldId} className="text-sm text-ink-muted">
                {/* No label means the viewer lacks fields:view — never print the id. */}
                <span className="text-ink-soft">{change.label ?? 'A field'}: </span>
                {change.from === undefined || change.from === null || change.from === '' ? null : (
                  <span className="text-ink-soft line-through">
                    {renderValue(fields, change.fieldId, change.from)}{' '}
                  </span>
                )}
                {renderValue(fields, change.fieldId, change.to)}
              </li>
            ))}
          </ul>
        ) : null}

        {redacted ? (
          <p className="mt-1 text-sm text-ink-soft">Changed fields your role can’t see.</p>
        ) : null}
      </div>
    </li>
  );
}

function renderValue(fields: readonly FieldDefinition[], fieldId: string, value: unknown): string {
  const field = fields.find((row) => row.id === fieldId || row.key === fieldId);
  if (value === undefined || value === null || value === '') return '—';
  if (field) return formatFieldValue(field, value);
  // No field definition to format against — usually a viewer without
  // fields:view. JSON rather than String(), which renders objects as
  // "[object Object]".
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value) ?? '—';
}
