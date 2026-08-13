import { toCsv } from '@falcon/validation';

import type { SellerListInput, SellerListRecord, SellerReadRepository } from '../routes/leads.js';
import type { ResolvedCondition } from '../leads/filter-validation.js';
import type { resolveAuthorization } from '@falcon/permission-engine';

/**
 * The Seller List, run to completion and written as CSV.
 *
 * Deliberately not a second query that resembles the list. It calls the *same*
 * `listSellers` with the *same* record predicate and the *same* visible-field
 * set, one page at a time, so "an export never returns a row or a field the same
 * user could not see in the list" is a property of there being one
 * implementation rather than a property anyone has to keep true by review. A
 * future change to scope, filtering or redaction lands on both at once, and
 * cannot land on only one. See ADR-0016.
 */

/** Read in pages so one export never materializes more than this at a time. */
const pageSize = 500;
export const maxExportRows = 50_000;

export interface ExportFieldColumn {
  id: string;
  /** The admin's configured name. Never a hardcoded key. */
  name: string;
}

export interface ExportResult {
  csv: string;
  rowCount: number;
  /** True when `maxExportRows` cut the export short — said, never silent. */
  truncated: boolean;
  fieldIds: readonly string[];
}

const coreHeaders = [
  'lead_id',
  'name',
  'phone',
  'email',
  'journey',
  'status',
  'owner',
  'created_at',
  'updated_at',
] as const;

export async function buildSellerExport(input: {
  organizationId: string;
  sellerRepository: SellerReadRepository;
  recordPredicate: NonNullable<Awaited<ReturnType<typeof resolveAuthorization>>['recordPredicate']>;
  conditions: readonly ResolvedCondition[];
  list: SellerListInput;
  /** Exactly the Fields the permission engine said this caller may see. */
  fields: readonly ExportFieldColumn[];
}): Promise<ExportResult> {
  const rows: (string | null)[][] = [];
  let truncated = false;

  for (let page = 1; ; page += 1) {
    const result = await input.sellerRepository.listSellers({
      ...input.list,
      page,
      pageSize,
      organizationId: input.organizationId,
      recordPredicate: input.recordPredicate,
      conditions: input.conditions,
    });
    for (const record of result.rows) {
      for (const line of expand(record, input.fields, input.recordPredicate.journeyIds)) {
        if (rows.length >= maxExportRows) {
          truncated = true;
          break;
        }
        rows.push(line);
      }
      if (truncated) break;
    }
    if (truncated) break;
    if (page * pageSize >= result.total || result.rows.length === 0) break;
  }

  return {
    csv: toCsv([...coreHeaders, ...input.fields.map((field) => field.name)], rows),
    rowCount: rows.length,
    truncated,
    fieldIds: input.fields.map((field) => field.id),
  };
}

/**
 * One CSV line per (lead × visible active process instance).
 *
 * The list view renders `processInstances[0]` only, so a lead in three journeys
 * shows as one row there. Exporting it that way would silently drop two
 * memberships, and would not round-trip back through the importer — which
 * creates one process instance per row. The journey re-filter is not
 * decoration: it stops an instance in a journey the caller's role cannot reach
 * from riding out on a lead they can otherwise see.
 *
 * A lead with no visible instance still exports one line, because the caller
 * can see the lead — it simply has no journey to name.
 */
function expand(
  record: SellerListRecord,
  fields: readonly ExportFieldColumn[],
  journeyIds: readonly string[],
): (string | null)[][] {
  const allowed = new Set(journeyIds);
  const values = fields.map((field) => stringify(record.fieldValues[field.id]));
  const base = (
    journey: string | null,
    status: string | null,
    owner: string | null,
  ): (string | null)[] => [
    record.id,
    record.name,
    record.phone,
    record.email,
    journey,
    status,
    owner,
    record.createdAt?.toISOString() ?? null,
    record.updatedAt?.toISOString() ?? null,
    ...values,
  ];

  const visible = record.processInstances.filter((process) => allowed.has(process.journeyId));
  if (visible.length === 0) return [base(null, null, null)];
  return visible.map((process) => base(process.journeyName, process.statusName, process.ownerName));
}

/** Field values are configuration-shaped JSON; render them without inventing form. */
function stringify(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
