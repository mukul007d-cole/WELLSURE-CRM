import type { FieldDefinition } from '../types/domain';

/** Fields with no configured section, grouped last under a neutral heading. */
const UNSECTIONED = 'Other details';

export interface FieldSection {
  name: string;
  fields: FieldDefinition[];
}

/**
 * Group a lead's Fields by their configured `Field.section`.
 *
 * Section names are administrator configuration, never a fixed list — a
 * deployment that configures no sections gets one group and the same flat
 * layout as before. Order follows first appearance in the field list, which is
 * the order the configuration API already returns (admin-controlled via
 * `sortOrder`/`reorderFields`, not creation order), so an admin controls the
 * section order by ordering the fields.
 *
 * `include` decides which fields are grouped at all: the read-only Details
 * view (and the PDF export) only wants ones the record actually has a value
 * for, while the create/edit form wants every field, filled in or not — so
 * this takes a predicate rather than assuming either. Shared between the two
 * pages (not owned by either) so neither has to import across page
 * directories to use it.
 */
export function groupFieldsBySection(
  fields: readonly FieldDefinition[],
  include: (field: FieldDefinition) => boolean = () => true,
): FieldSection[] {
  const sections: FieldSection[] = [];
  const byName = new Map<string, FieldSection>();
  let unsectioned: FieldSection | undefined;

  for (const field of fields) {
    if (!include(field)) continue;
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
