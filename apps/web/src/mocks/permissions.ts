import { FIELDS, type MockLead, type MockUser } from './fixtures';

const FIELD_ID_TO_KEY = new Map(FIELDS.map((field) => [field.id, field.key]));

export function visibleFieldKeys(user: MockUser): Set<string> {
  return new Set(
    FIELDS.filter((field) => !user.restrictedFieldIds.includes(field.id)).map((field) => field.key),
  );
}

export function stripFieldValues(
  fieldValues: Record<string, unknown>,
  user: MockUser,
): Record<string, unknown> {
  const visible = visibleFieldKeys(user);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fieldValues)) {
    if (visible.has(key)) result[key] = value;
  }
  return result;
}

export function restrictedFieldKeys(user: MockUser): string[] {
  return user.restrictedFieldIds
    .map((id) => FIELD_ID_TO_KEY.get(id))
    .filter((key): key is string => Boolean(key));
}

export function isLeadInScope(lead: MockLead, user: MockUser): boolean {
  if (user.dataScope === 'ORGANIZATION') return true;
  return lead.processInstances.some((process) =>
    process.assignments.some((assignment) => assignment.userId === user.id),
  );
}
