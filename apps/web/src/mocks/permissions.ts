import { FIELDS, type MockLead, type MockUser } from './fixtures';

/**
 * `fieldValues` is keyed by Field id, matching the real API — `field_values`
 * is a JSONB column the backend addresses by id everywhere (the GIN-indexed
 * containment queries, `field_journey_settings`, field-visibility redaction).
 * A field's `key` is a separate, human-readable identifier used only for
 * things like URL-safe references and generated names — never for indexing
 * into a lead's own field values.
 */
export function visibleFieldIds(user: MockUser): Set<string> {
  return new Set(
    FIELDS.filter((field) => !user.restrictedFieldIds.includes(field.id)).map((field) => field.id),
  );
}

export function stripFieldValues(
  fieldValues: Record<string, unknown>,
  user: MockUser,
): Record<string, unknown> {
  const visible = visibleFieldIds(user);
  const result: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(fieldValues)) {
    if (visible.has(id)) result[id] = value;
  }
  return result;
}

export function isLeadInScope(lead: MockLead, user: MockUser): boolean {
  if (user.dataScope === 'ORGANIZATION') return true;
  return lead.processInstances.some((process) =>
    process.assignments.some((assignment) => assignment.userId === user.id),
  );
}
