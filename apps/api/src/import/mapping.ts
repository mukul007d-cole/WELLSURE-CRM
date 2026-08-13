import { ImportError } from './errors.js';
import type { CoreColumn, ImportMapping, MatchKey } from './types.js';

/**
 * Turning "column 7 goes to Field X" into something the row loop can execute,
 * and refusing anything that cannot be executed *before* the first row runs.
 *
 * Every check here is a file-level check — one that would otherwise reject all
 * five thousand rows for the same reason. Anything that can legitimately differ
 * per row is deliberately left to `LeadService.createLead`, which is the real
 * validation path and the only one whose verdict counts.
 */

export interface ImportFieldDefinition {
  id: string;
  key: string;
  name: string;
  fieldType: string;
}

export interface ImportStatusDefinition {
  id: string;
  key: string;
  name: string;
}

export interface MappingContext {
  header: readonly string[];
  /** Active Fields assigned to the chosen Journey and not `hidden` there. */
  fields: readonly ImportFieldDefinition[];
  /** Active Statuses of the chosen Journey. */
  statuses: readonly ImportStatusDefinition[];
}

export type ResolvedMatchKey =
  | { kind: 'core'; column: CoreColumn; index: number }
  | { kind: 'field'; fieldId: string; fieldType: string; index: number };

export interface ResolvedMapping {
  journeyId: string;
  statusId: string | undefined;
  fileAssignments: readonly { assignmentType: string; userId: string }[];
  nameIndex: number;
  phoneIndex: number | null;
  emailIndex: number | null;
  fieldColumns: readonly { index: number; fieldId: string; fieldType: string }[];
  assignmentColumns: readonly { index: number; assignmentType: string }[];
  statusColumnIndex: number | null;
  matchKeys: readonly ResolvedMatchKey[];
  /** Every Field the file writes to — the set authorization is decided against. */
  mappedFieldIds: readonly string[];
  /** Every assignment type the file uses, per-file and per-row together. */
  assignmentTypes: readonly string[];
}

function invalid(message: string, details: Record<string, unknown> = {}): ImportError {
  return new ImportError('validation_error', message, details);
}

export function validateMapping(mapping: ImportMapping, context: MappingContext): ResolvedMapping {
  const fieldsById = new Map(context.fields.map((field) => [field.id, field]));
  const headerIndex = new Map(context.header.map((name, index) => [name, index]));

  /*
   * Every header column must carry an explicit entry, including `skip`.
   *
   * Defaulting an unlisted column to `skip` would be friendlier and would break
   * the phase's own rule that no column is silently given a target — because the
   * same leniency that quietly skips a column the client forgot is what would
   * quietly accept a client that guessed. The UI always sends all of them.
   */
  for (const name of context.header) {
    if (!(name in mapping.columns)) {
      throw invalid('every source column needs a mapping, including skip', { column: name });
    }
  }
  for (const name of Object.keys(mapping.columns)) {
    if (!headerIndex.has(name)) {
      throw invalid('the mapping names a column that is not in the file', { column: name });
    }
  }

  const claimed = new Map<string, string>();
  const claim = (token: string, column: string) => {
    const existing = claimed.get(token);
    if (existing !== undefined) {
      throw invalid('two columns are mapped to the same target', {
        column,
        conflictsWith: existing,
      });
    }
    claimed.set(token, column);
  };

  let nameIndex: number | null = null;
  let phoneIndex: number | null = null;
  let emailIndex: number | null = null;
  let statusColumnIndex: number | null = null;
  const fieldColumns: { index: number; fieldId: string; fieldType: string }[] = [];
  const assignmentColumns: { index: number; assignmentType: string }[] = [];

  for (const [column, target] of Object.entries(mapping.columns)) {
    const index = headerIndex.get(column)!;
    switch (target.kind) {
      case 'skip':
        break;
      case 'core': {
        claim(`core:${target.column}`, column);
        if (target.column === 'name') nameIndex = index;
        if (target.column === 'phone') phoneIndex = index;
        if (target.column === 'email') emailIndex = index;
        break;
      }
      case 'field': {
        const field = fieldsById.get(target.fieldId);
        if (field === undefined) {
          // Covers all three ways a Field can be unusable here — inactive, not
          // assigned to this Journey, or `hidden` for it — because the context
          // only ever contains usable ones. This feature never creates a Field.
          throw invalid('that field is not available on the chosen journey', {
            column,
            fieldId: target.fieldId,
          });
        }
        claim(`field:${field.id}`, column);
        fieldColumns.push({ index, fieldId: field.id, fieldType: field.fieldType });
        break;
      }
      case 'assignment': {
        const assignmentType = target.assignmentType.trim();
        if (assignmentType === '') throw invalid('assignment type is required', { column });
        claim(`assignment:${assignmentType}`, column);
        assignmentColumns.push({ index, assignmentType });
        break;
      }
      case 'status': {
        claim('status', column);
        statusColumnIndex = index;
        break;
      }
    }
  }

  if (nameIndex === null) {
    // `createLead` requires a non-blank name, so a file without one rejects
    // every row identically. Say so once, up front.
    throw invalid('one column must be mapped to the lead name');
  }

  for (const assignment of mapping.assignments) {
    if (assignment.assignmentType.trim() === '') throw invalid('assignment type is required');
    if (assignment.userId.trim() === '') throw invalid('assignment user is required');
    // A whole-file assignment and a per-row column of the same type would both
    // try to own the row. The partial unique index on current assignments would
    // catch it at insert; refusing here names the actual conflict instead.
    claim(`assignment:${assignment.assignmentType.trim()}`, '(whole file)');
  }

  if (statusColumnIndex !== null && context.statuses.length === 0) {
    throw invalid('the chosen journey has no active statuses to match against');
  }

  const matchKeys = mapping.matchKeys.map((key) =>
    resolveMatchKey(key, mapping, headerIndex, fieldsById),
  );

  return {
    journeyId: mapping.journeyId,
    statusId: mapping.statusId,
    fileAssignments: mapping.assignments.map((assignment) => ({
      assignmentType: assignment.assignmentType.trim(),
      userId: assignment.userId.trim(),
    })),
    nameIndex,
    phoneIndex,
    emailIndex,
    fieldColumns,
    assignmentColumns,
    statusColumnIndex,
    matchKeys,
    mappedFieldIds: fieldColumns.map((column) => column.fieldId),
    assignmentTypes: [
      ...new Set([
        ...mapping.assignments.map((assignment) => assignment.assignmentType.trim()),
        ...assignmentColumns.map((column) => column.assignmentType),
      ]),
    ],
  };
}

function resolveMatchKey(
  key: MatchKey,
  mapping: ImportMapping,
  headerIndex: ReadonlyMap<string, number>,
  fieldsById: ReadonlyMap<string, ImportFieldDefinition>,
): ResolvedMatchKey {
  // A match key has to read a column the file actually maps. Matching on a
  // target nothing writes to would compare every row against an empty value,
  // which silently means "never a duplicate" — worse than refusing.
  for (const [column, target] of Object.entries(mapping.columns)) {
    const index = headerIndex.get(column)!;
    if (key.kind === 'core' && target.kind === 'core' && target.column === key.column) {
      return { kind: 'core', column: key.column, index };
    }
    if (key.kind === 'field' && target.kind === 'field' && target.fieldId === key.fieldId) {
      const field = fieldsById.get(key.fieldId)!;
      return { kind: 'field', fieldId: key.fieldId, fieldType: field.fieldType, index };
    }
  }
  throw invalid('a duplicate-matching key is not mapped to any column', {
    ...(key.kind === 'core' ? { column: key.column } : { fieldId: key.fieldId }),
  });
}

/**
 * A cell, typed the way its Field expects.
 *
 * `undefined` means "the cell is blank, so write no value" — distinct from a
 * value that fails validation. The split of responsibility is deliberate:
 * turning CSV text into JSON of the right type is the importer's job, and
 * deciding whether the resulting value is *acceptable* is
 * `validateFieldValues`', which is the real path and stays the only judge of
 * patterns, lengths and requiredness.
 */
export function coerceCell(fieldType: string, raw: string): unknown {
  const value = raw.trim();
  if (value === '') return undefined;
  switch (fieldType) {
    case 'number': {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw invalid('value is not a number', { value });
      }
      return parsed;
    }
    case 'boolean': {
      const lowered = value.toLowerCase();
      if (['true', 'yes', 'y', '1'].includes(lowered)) return true;
      if (['false', 'no', 'n', '0'].includes(lowered)) return false;
      throw invalid('value is not a yes/no', { value });
    }
    case 'json': {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        throw invalid('value is not valid JSON');
      }
    }
    default:
      // text, textarea, email, phone, date, select — and any Field type added
      // later, which reaches `validateValue` as a string and is judged there
      // rather than being guessed at here.
      return value;
  }
}

/** Case-insensitive Status resolution by the admin's own configured name or key. */
export function resolveStatusByLabel(
  statuses: readonly ImportStatusDefinition[],
  raw: string,
): ImportStatusDefinition | null {
  const wanted = raw.trim().toLowerCase();
  if (wanted === '') return null;
  return (
    statuses.find(
      (status) => status.name.toLowerCase() === wanted || status.key.toLowerCase() === wanted,
    ) ?? null
  );
}
