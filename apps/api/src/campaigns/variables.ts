import type { CampaignDocument } from './document.js';
import { documentTokens } from './document.js';

/**
 * Variable availability is resolved against the **campaign creator's** field
 * visibility, at create and edit time.
 *
 * One template serves a whole batch, so there is no single recipient whose
 * visibility could govern interpolation; per-recipient gating would make the
 * same template render differently per send, which is not a coherent thing for
 * a shared document. The consequence is recorded in the Phase 13c plan: a token
 * stays in the template if its author later loses access to that Field, and the
 * value still interpolates. That is an authoring-time decision, reviewed like
 * any other content.
 */

export const coreTokens = ['name', 'email', 'phone'] as const;
export type CoreToken = (typeof coreTokens)[number];

export const fieldTokenPrefix = 'field:';

export function fieldTokenFor(fieldId: string): string {
  return `${fieldTokenPrefix}${fieldId}`;
}

export function fieldIdFromToken(token: string): string | null {
  return token.startsWith(fieldTokenPrefix) ? token.slice(fieldTokenPrefix.length) : null;
}

/** Tokens the document uses that the author may not use. */
export function unauthorizedTokens(
  document: CampaignDocument,
  visibleFieldIds: ReadonlySet<string>,
): string[] {
  return documentTokens(document).filter((token) => {
    if ((coreTokens as readonly string[]).includes(token)) return false;
    const fieldId = fieldIdFromToken(token);
    // An unknown token is left alone at render time rather than rejected here:
    // it may be literal text the author wants. Only a *field* token naming a
    // Field the author cannot see is refused.
    return fieldId === null ? false : !visibleFieldIds.has(fieldId);
  });
}

export interface RecipientData {
  name: string;
  email: string | null;
  phone: string | null;
  fieldValues: Record<string, unknown>;
}

/** One recipient's values, keyed by token. */
export function variablesFor(lead: RecipientData): Map<string, string> {
  const variables = new Map<string, string>([
    ['name', lead.name],
    ['email', lead.email ?? ''],
    ['phone', lead.phone ?? ''],
  ]);
  for (const [fieldId, value] of Object.entries(lead.fieldValues))
    variables.set(fieldTokenFor(fieldId), stringify(value));
  return variables;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}
