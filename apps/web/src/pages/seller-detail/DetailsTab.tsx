import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatFieldValue } from '../../lib/format';
import type { FieldDefinition } from '../../types/domain';

/** Fields with no configured section, grouped last under a neutral heading. */
const UNSECTIONED = 'Other details';

export interface FieldSection {
  name: string;
  fields: FieldDefinition[];
}

/**
 * Group a lead's visible fields by their configured `Field.section`.
 *
 * Section names are administrator configuration, never a fixed list — a
 * deployment that configures no sections gets one group and the same flat
 * layout as before. Order follows first appearance in the field list, which is
 * the order the configuration API already returns, so an admin controls the
 * section order by ordering the fields.
 */
export function groupFieldsBySection(
  fields: readonly FieldDefinition[],
  fieldValues: Record<string, unknown>,
): FieldSection[] {
  const sections: FieldSection[] = [];
  const byName = new Map<string, FieldSection>();
  let unsectioned: FieldSection | undefined;

  for (const field of fields) {
    if (!(field.key in fieldValues)) continue;
    const name = field.section?.trim();
    if (!name) {
      unsectioned ??= { name: UNSECTIONED, fields: [] };
      unsectioned.fields.push(field);
      continue;
    }
    let section = byName.get(name);
    if (!section) {
      section = { name, fields: [] };
      byName.set(name, section);
      sections.push(section);
    }
    section.fields.push(field);
  }
  // Always last: an unnamed group shouldn't jump ahead of named ones.
  if (unsectioned) sections.push(unsectioned);
  return sections;
}

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

  const sections = groupFieldsBySection(fields, fieldValues);
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
            <h3 className="mb-3 border-b border-line-soft pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-soft">
              {section.name}
            </h3>
          ) : null}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            {section.fields.map((field) => (
              <div key={field.id}>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                  {field.label}
                </dt>
                <dd className="mt-1 text-sm text-ink">
                  {formatFieldValue(field, fieldValues[field.key])}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
