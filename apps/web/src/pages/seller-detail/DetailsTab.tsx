import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { Eyebrow } from '../../components/ui/Heading';
import { groupFieldsBySection } from '../../lib/field-sections';
import { formatFieldValue } from '../../lib/format';
import type { FieldDefinition } from '../../types/domain';

export function DetailsTab({
  fields,
  fieldValues,
  isPending,
}: {
  fields: readonly FieldDefinition[];
  fieldValues: Record<string, unknown>;
  isPending: boolean;
}) {
  if (isPending) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  const sections = groupFieldsBySection(fields, (field) => field.id in fieldValues);
  if (sections.length === 0) {
    return (
      <EmptyState
        title="No details to show"
        description="This seller has no field values your role can see."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {sections.map((section) => (
        <section key={section.name}>
          {/* Suppressed when there is only one group — a lone heading over
              every field on the page is noise, not structure. */}
          {sections.length > 1 ? (
            <Eyebrow as="h3" className="mb-3 border-b border-line-soft pb-1.5">
              {section.name}
            </Eyebrow>
          ) : null}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            {section.fields.map((field) => (
              <div key={field.id}>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                  {field.label}
                </dt>
                <dd className="mt-1 text-sm text-ink">
                  {formatDetailValue(field, fieldValues[field.id])}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

/**
 * `formatFieldValue` predates the ADR-0026 types: it would print a
 * `multi_select` list as JSON and a `datetime` instant as its raw ISO string.
 * Both are handled here first; every other type is unchanged.
 */
function formatDetailValue(field: FieldDefinition, value: unknown): string {
  if (field.type === 'multi_select' && Array.isArray(value)) {
    return value.length === 0 ? '—' : value.map(String).join(', ');
  }
  if (field.type === 'datetime' && typeof value === 'string' && value !== '') {
    const date = new Date(value);
    // A malformed stored value is shown as-is rather than as "Invalid Date".
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  return formatFieldValue(field, value);
}
