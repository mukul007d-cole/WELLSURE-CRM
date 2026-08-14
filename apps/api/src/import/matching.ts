import type { ResolvedMatchKey } from './mapping.js';

/**
 * Duplicate detection for an import.
 *
 * There was nothing to reuse. `RepeatLeadTab` is a client-side substring search
 * over the already-scoped Seller List, and
 * `findActiveProcessInstanceByLeadJourney` answers a different question — "is
 * this lead already in this journey" — so this is a new mechanism, built to be
 * configuration rather than code (ADR-0016).
 *
 * ADR-0004's Cronberry ladder (`audience_id`, then the marketplace token, then
 * GST+phone, then phone) is expressible here as a *choice of keys at import
 * time*. None of those column names appears in this file, or anywhere else in
 * the application, which is the whole point.
 *
 * Raw SQL rather than the Prisma builder, for the same reason `filter-sql.ts`
 * is: only these exact forms reach an index. `lower(email) = lower($n)` uses
 * `leads_email_lower_idx`; Prisma's `mode: 'insensitive'` emits `ILIKE`, which
 * does not. `field_values @> $n::jsonb` uses `leads_field_values_gin_idx`;
 * every other JSON form Prisma can emit walks it. Every value is bound as a
 * parameter — nothing is interpolated.
 */

export interface MatchValue {
  key: ResolvedMatchKey;
  /** The typed value: a trimmed string for core columns, coerced JSON for Fields. */
  value: unknown;
}

export interface MatchedLead {
  id: string;
  name: string;
}

export interface MatchQuery {
  text: string;
  values: unknown[];
}

/**
 * `null` when the row cannot be matched at all.
 *
 * A key whose cell is blank makes the row unmatchable rather than matching
 * every lead that is also blank there — two leads with no email are not the
 * same person. Stated here because it is the rule most likely to surprise:
 * turning matching on does not mean every row is checked, only every row that
 * carries a value for each key.
 */
export function buildDuplicateQuery(
  organizationId: string,
  values: readonly MatchValue[],
): MatchQuery | null {
  if (values.length === 0) return null;
  const params: unknown[] = [organizationId];
  const bind = (value: unknown, cast = '') => {
    params.push(value);
    return `$${params.length}${cast}`;
  };
  const clauses: string[] = [];

  for (const { key, value } of values) {
    if (value === undefined || value === null || value === '') return null;
    if (key.kind === 'core') {
      // A core column is a text column, so a non-string here is not a value to
      // coerce — it means the caller built the match value wrongly, and
      // stringifying it would compare `[object Object]` against every lead.
      if (typeof value !== 'string') return null;
      switch (key.column) {
        case 'email':
          clauses.push(`lower(l.email) = lower(${bind(value)})`);
          break;
        case 'phone':
          clauses.push(`l.phone = ${bind(value)}`);
          break;
        case 'name':
          clauses.push(`l.name = ${bind(value)}`);
          break;
      }
      continue;
    }
    clauses.push(`l.field_values @> ${bind(JSON.stringify({ [key.fieldId]: value }), '::jsonb')}`);
  }

  return {
    // Oldest wins, so a row matching several existing leads resolves the same
    // way every time — a preview that named one lead and a commit that named
    // another would be a fidelity break even though both are "correct".
    text:
      `SELECT l.id, l.name FROM leads l ` +
      `WHERE l.organization_id = $1::uuid AND l.active AND ${clauses.join(' AND ')} ` +
      `ORDER BY l.created_at ASC, l.id ASC LIMIT 1`,
    values: params,
  };
}
