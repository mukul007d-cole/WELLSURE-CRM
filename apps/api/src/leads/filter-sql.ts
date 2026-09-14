import type { RecordPredicate } from '@falcon/permission-engine';

import type { ResolvedCondition } from './filter-validation.js';

/**
 * Compiles the scoped Seller List query.
 *
 * Why raw SQL rather than Prisma's builder: measured against 200k leads, only
 * column-level containment (`field_values @> …`) reaches
 * `leads_field_values_gin_idx`. Every JSON filter Prisma can emit compiles to
 * `field_values #> ARRAY[…]` expression comparison — including its
 * `array_contains`, which applies `@>` to the *extracted sub-document* rather
 * than the indexed column. On a selective filter with ORDER BY + LIMIT that is
 * 116ms of index-walking versus 1.1ms of index scan.
 *
 * The cost of leaving the builder is that data scope is expressed here as well
 * as in `sellerWhere`. Nothing but a test keeps the two honest, so
 * `phase13b.postgres.integration.test.ts` asserts they select identical id sets
 * across every scope and access mode.
 *
 * Every value — including field ids used as JSON keys — is bound as a
 * parameter. Nothing is interpolated into SQL text.
 */

export interface SqlFragment {
  text: string;
  values: unknown[];
}

export interface SellerListQueryInput {
  organizationId: string;
  predicate: RecordPredicate;
  conditions: readonly ResolvedCondition[];
  search?: string | undefined;
  journeyId?: string | undefined;
  statusId?: string | undefined;
  ownerUserId?: string | undefined;
  accessMode?: 'mine' | 'shared_with_me' | 'all' | undefined;
  sortBy?: 'createdAt' | 'updatedAt' | 'name' | undefined;
  sortDirection?: 'asc' | 'desc' | undefined;
  /**
   * Restrict to these ids, on top of everything else.
   *
   * Bulk import uses it to ask "which of the leads my duplicate check matched
   * may this importer actually be told about?" — a question that has to be
   * answered by the *same* clause the Seller List uses, not by a second
   * scoping rule that could drift from it.
   */
  leadIds?: readonly string[] | undefined;
  page: number;
  pageSize: number;
  now?: Date | undefined;
}

class Params {
  readonly values: unknown[] = [];
  bind(value: unknown, cast = ''): string {
    this.values.push(value);
    return `$${this.values.length}${cast}`;
  }
}

const sortColumns = {
  createdAt: 'l.created_at',
  updatedAt: 'l.updated_at',
  name: 'l.name',
} as const;

export function buildSellerListQuery(input: SellerListQueryInput): {
  ids: SqlFragment;
  count: SqlFragment;
} {
  const idParams = new Params();
  const idWhere = whereClause(input, idParams);
  const column = sortColumns[input.sortBy ?? 'updatedAt'];
  const direction = input.sortDirection === 'asc' ? 'ASC' : 'DESC';
  const offset = (input.page - 1) * input.pageSize;
  // `l.id` breaks ties so paging can't repeat or skip a row when the sort
  // column collides, which it does constantly on bulk-imported data.
  const ids: SqlFragment = {
    text: `SELECT l.id FROM leads l WHERE ${idWhere} ORDER BY ${column} ${direction}, l.id ASC LIMIT ${idParams.bind(input.pageSize)} OFFSET ${idParams.bind(offset)}`,
    values: idParams.values,
  };

  const countParams = new Params();
  const count: SqlFragment = {
    text: `SELECT count(*)::int AS total FROM leads l WHERE ${whereClause(input, countParams)}`,
    values: countParams.values,
  };
  return { ids, count };
}

/** The one clause both the page query and the count query are built from. */
function whereClause(input: SellerListQueryInput, params: Params): string {
  const parts = [
    `l.organization_id = ${params.bind(input.organizationId, '::uuid')}`,
    'l.active',
    accessClause(input, params),
  ];
  if (input.leadIds !== undefined) {
    parts.push(`l.id = ANY(${params.bind([...input.leadIds], '::uuid[]')})`);
  }
  if (input.search !== undefined && input.search.trim() !== '') {
    const term = params.bind(`%${escapeLike(input.search.trim())}%`);
    parts.push(
      `(l.name ILIKE ${term} ESCAPE '\\' OR l.phone ILIKE ${term} ESCAPE '\\' OR l.email ILIKE ${term} ESCAPE '\\')`,
    );
  }
  for (const condition of input.conditions) parts.push(conditionClause(condition, params));
  return parts.join(' AND ');
}

/**
 * Data scope. Filters are ANDed alongside this, never in place of it, so no
 * filter can reach a record the caller's scope excludes.
 *
 * All three branches must independently enforce Status Visibility (Phase
 * 19, reworked Phase 20): `resolveAuthorization`'s `statusVisible` check
 * (packages/permission-engine/src/decision.ts) is unconditional — it denies
 * regardless of *how* the caller reached the record, assignment or direct
 * grant alike — so a lead shared directly with someone this check excludes
 * must not stay visible here just because it arrived through
 * `user_access_grants` rather than `processExists()`'s assignment path.
 * Only `processExists()` itself
 * (the `mine` branch, and the first half of the `all` OR) got this in the
 * original pass; `shared_with_me` and the `all` branch's own shared-record
 * arm are two independent lookups against `process_instances` and each needs
 * its own copy of the same check — see
 * `phase19.postgres.integration.test.ts`'s direct-grant test, which pins
 * this the same way the multi-Journey test pins `processExists()`'s
 * placement.
 */
function accessClause(input: SellerListQueryInput, params: Params): string {
  /*
   * Each branch binds only the parameters it uses. Building the unused branch
   * first left orphan placeholders in the values array, and Postgres rejects a
   * statement whose parameters are never referenced — "could not determine data
   * type of parameter $2".
   */
  if (input.accessMode === 'shared_with_me')
    return `(${grantExists(input, params, 'view')} AND ${anyProcessStatusVisible(input, params)})`;
  const process = processExists(input, params);
  if (input.accessMode === 'mine') return process;
  // Default 'all': assigned records, or records shared directly with the caller
  // that still sit inside a Journey the caller can see *and* a Status
  // Visibility doesn't exclude them from — the same (journey, status) pair
  // `processExists()` requires of an assigned record, checked against the
  // same process instance rather than two independent ones.
  const shared = grantExists(input, params, input.predicate.directGrantAction);
  const journeyIds = params.bind([...input.predicate.journeyIds], '::uuid[]');
  const sharedProcessVisible = `EXISTS (SELECT 1 FROM process_instances pj WHERE pj.organization_id = l.organization_id AND pj.lead_id = l.id AND pj.active AND pj.journey_id = ANY(${journeyIds}) AND ${statusVisibilityClause(input, params, 'pj')})`;
  return `(${process} OR (${shared} AND ${sharedProcessVisible}))`;
}

function processExists(input: SellerListQueryInput, params: Params): string {
  const journeyIds = params.bind(
    input.journeyId === undefined ? [...input.predicate.journeyIds] : [input.journeyId],
    '::uuid[]',
  );
  const parts = [
    'p.organization_id = l.organization_id',
    'p.lead_id = l.id',
    'p.active',
    `p.journey_id = ANY(${journeyIds})`,
    // Status Visibility (Phase 19, reworked Phase 20) — *inside* this
    // per-process EXISTS, not a sibling clause on `leads`. A lead with two
    // process instances, one in a Status this check excludes the caller
    // from and one in an open or allowed one, must stay visible through the
    // surviving process, exactly as Journey access already works across
    // multiple Journeys. Moving this clause
    // outside the per-process EXISTS would instead require *every* process
    // instance to pass, silently inverting that rule — see
    // `phase19.postgres.integration.test.ts`'s multi-Journey test, which
    // pins this placement directly.
    statusVisibilityClause(input, params, 'p'),
  ];
  if (input.statusId !== undefined)
    parts.push(`p.current_status_id = ${params.bind(input.statusId, '::uuid')}`);

  const assignment = [
    'a.organization_id = p.organization_id',
    'a.process_instance_id = p.id',
    'a.is_current',
  ];
  /*
   * An empty assignmentTypes list means the caller named no particular type, so
   * no type filter applies. Rendering it as `= ANY('{}')` would match nothing
   * and silently empty the list for every caller that omits the parameter —
   * the defect `seller-list-predicate.test.ts` exists to pin down. Scope is
   * still enforced by user id below.
   */
  if (input.predicate.assignmentTypes.length > 0)
    assignment.push(
      `a.assignment_type = ANY(${params.bind([...input.predicate.assignmentTypes], '::text[]')})`,
    );
  if (input.ownerUserId !== undefined)
    assignment.push(`a.user_id = ${params.bind(input.ownerUserId, '::uuid')}`);
  if (input.predicate.allowedUserIds !== 'ALL_ORGANIZATION_USERS')
    assignment.push(
      `a.user_id = ANY(${params.bind([...input.predicate.allowedUserIds], '::uuid[]')})`,
    );

  return `EXISTS (SELECT 1 FROM process_instances p WHERE ${parts.join(' AND ')} AND EXISTS (SELECT 1 FROM assignments a WHERE ${assignment.join(' AND ')}))`;
}

/**
 * Status Visibility (Phase 19, reworked Phase 20): `NOT EXISTS (an active
 * routing rule for this process's current Status) OR EXISTS (a current
 * assignment on this process instance held by the caller or one of the
 * caller's active reports, any depth)` — a Status with no active routing
 * rule imposes no restriction (the default, unrouted state); one with an
 * active rule narrows visibility to the lead's current assignee and that
 * assignee's reporting-hierarchy ancestors. No Role plays any part in this
 * check — `input.predicate.hierarchyUserIds` is the caller's own id plus
 * every active user reachable downward through `manager_id`
 * (`expandScopeUserIds(..., 'TEAM')`, computed once per request regardless
 * of the caller's own granted scope for this action).
 *
 * `alias` names the `process_instances` row this is correlated against —
 * `p` inside `processExists()`, `pj` inside the `all` branch's shared-record
 * arm, `pv` inside `anyProcessStatusVisible()` — so the same clause can be
 * spliced into any of the three independent `process_instances` lookups
 * `accessClause()` runs, always asking the question of the one row its
 * enclosing `EXISTS` is testing rather than of `leads` as a whole.
 *
 * ADR-0021: `input.predicate.bypassesStatusVisibility` short-circuits this
 * to an unconditional `TRUE` — the SQL mirror of `decision.ts` returning
 * `true` from `statusVisible` without ever checking for a routing rule.
 * Bound before anything else, so a bypassing caller never even binds the
 * (possibly still-empty) `hierarchyUserIds` parameter.
 */
function statusVisibilityClause(
  input: SellerListQueryInput,
  params: Params,
  alias: string,
): string {
  if (input.predicate.bypassesStatusVisibility) return 'TRUE';
  const hierarchyUserIds = params.bind([...input.predicate.hierarchyUserIds], '::uuid[]');
  const assignmentTypeFilter =
    input.predicate.assignmentTypes.length > 0
      ? ` AND a.assignment_type = ANY(${params.bind([...input.predicate.assignmentTypes], '::text[]')})`
      : '';
  return `(NOT EXISTS (SELECT 1 FROM status_routing_rules r WHERE r.organization_id = ${alias}.organization_id AND r.status_id = ${alias}.current_status_id AND r.active) OR EXISTS (SELECT 1 FROM assignments a WHERE a.organization_id = ${alias}.organization_id AND a.process_instance_id = ${alias}.id AND a.is_current AND a.user_id = ANY(${hierarchyUserIds})${assignmentTypeFilter}))`;
}

/**
 * Status Visibility (Phase 19, reworked Phase 20) for the `shared_with_me`
 * view: does this lead have at least one active process instance whose
 * current Status does not exclude the caller? `resolveAuthorization`'s
 * `statusVisible` check is unconditional
 * (packages/permission-engine/src/decision.ts) — it does not care whether
 * the caller reached the record through ordinary scope or a direct grant —
 * so a share must not bypass it.
 *
 * Deliberately no Journey filter here: `shared_with_me` already runs with no
 * Journey restriction today (`grantExists()` alone, unchanged by this fix),
 * and closing that separately is a distinct question from the one this
 * function answers — see the plan doc's correction.
 */
function anyProcessStatusVisible(input: SellerListQueryInput, params: Params): string {
  const alias = 'pv';
  return `EXISTS (SELECT 1 FROM process_instances ${alias} WHERE ${alias}.organization_id = l.organization_id AND ${alias}.lead_id = l.id AND ${alias}.active AND ${statusVisibilityClause(input, params, alias)})`;
}

function grantExists(input: SellerListQueryInput, params: Params, action: string): string {
  const userId = params.bind(input.predicate.includeDirectGrantsForUserId, '::uuid');
  const actionParam = params.bind(action);
  const now = params.bind(input.now ?? new Date(), '::timestamptz');
  return `EXISTS (SELECT 1 FROM user_access_grants g WHERE g.organization_id = l.organization_id AND g.lead_id = l.id AND g.user_id = ${userId} AND g.revoked_at IS NULL AND ${actionParam} = ANY(g.actions) AND (g.expires_at IS NULL OR g.expires_at > ${now}))`;
}

/**
 * One condition.
 *
 * Custom Fields use containment (`@>`) and key existence (`?`) wherever the
 * operator allows, because those are the only forms the GIN index serves.
 * `contains`, ranges and negations fall back to `->>` extraction and are
 * sequential scans; that ceiling is documented in the phase 13b plan rather
 * than hidden.
 */
function conditionClause(condition: ResolvedCondition, params: Params): string {
  return condition.target.kind === 'core'
    ? coreClause(condition, params)
    : fieldClause(condition, condition.target.fieldId, params);
}

function fieldClause(condition: ResolvedCondition, fieldId: string, params: Params): string {
  const key = () => params.bind(fieldId);
  const contains = (value: unknown) =>
    `l.field_values @> ${params.bind(JSON.stringify({ [fieldId]: value }), '::jsonb')}`;
  const text = () => `l.field_values ->> ${params.bind(fieldId)}`;

  switch (condition.operator) {
    case 'equals':
      return contains(condition.values[0]);
    case 'is_true':
      return contains(true);
    case 'is_false':
      return contains(false);
    case 'in':
      return `(${condition.values.map((value) => contains(value)).join(' OR ')})`;
    case 'not_in':
      return `NOT (${condition.values.map((value) => contains(value)).join(' OR ')})`;
    case 'is_not_empty':
      // The `?` operator, not jsonb_exists(): measured, only the operator form
      // is matched to the GIN index.
      return `(l.field_values ? ${key()} AND ${text()} <> '')`;
    case 'is_empty':
      return `(NOT (l.field_values ? ${key()}) OR ${text()} IS NULL OR ${text()} = '')`;
    case 'contains':
      return `${text()} ILIKE ${params.bind(`%${escapeLike(String(condition.values[0]))}%`)} ESCAPE '\\'`;
    case 'starts_with':
      return `${text()} ILIKE ${params.bind(`${escapeLike(String(condition.values[0]))}%`)} ESCAPE '\\'`;
    case 'greater_than':
      return `${numeric(text())} > ${params.bind(condition.values[0])}`;
    case 'less_than':
      return `${numeric(text())} < ${params.bind(condition.values[0])}`;
    case 'between':
      return condition.kind === 'number'
        ? `${numeric(text())} BETWEEN ${params.bind(condition.values[0])} AND ${params.bind(condition.values[1])}`
        : `${text()} BETWEEN ${params.bind(condition.values[0])} AND ${params.bind(condition.values[1])}`;
    case 'before':
      return `${text()} < ${params.bind(condition.values[0])}`;
    case 'after':
      return `${text()} > ${params.bind(condition.values[0])}`;
  }
}

/**
 * Guard the cast: a text Field holding 'abc' would otherwise abort the whole
 * query with an invalid-input error rather than simply not matching.
 */
function numeric(expression: string): string {
  return `(CASE WHEN ${expression} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${expression})::numeric END)`;
}

function coreClause(condition: ResolvedCondition, params: Params): string {
  const column = coreColumnSql(condition.target as { column: string });
  switch (condition.operator) {
    case 'equals':
      return `${column} = ${params.bind(condition.values[0])}`;
    case 'contains':
      return `${column} ILIKE ${params.bind(`%${escapeLike(String(condition.values[0]))}%`)} ESCAPE '\\'`;
    case 'starts_with':
      return `${column} ILIKE ${params.bind(`${escapeLike(String(condition.values[0]))}%`)} ESCAPE '\\'`;
    case 'is_empty':
      return `(${column} IS NULL OR ${column} = '')`;
    case 'is_not_empty':
      return `(${column} IS NOT NULL AND ${column} <> '')`;
    case 'before':
      return `${column} < ${params.bind(condition.values[0], '::date')}`;
    case 'after':
      // Inclusive of the whole named day, so "after 2026-01-01" doesn't drop
      // records created later that same day.
      return `${column} >= (${params.bind(condition.values[0], '::date')} + interval '1 day')`;
    case 'between':
      return `${column} >= ${params.bind(condition.values[0], '::date')} AND ${column} < (${params.bind(condition.values[1], '::date')} + interval '1 day')`;
    case 'in':
      return processIdClause(condition, params, false);
    case 'not_in':
      return processIdClause(condition, params, true);
    default:
      // number-only operators never resolve to a core column: no core column
      // has the `number` kind.
      throw new Error(`unsupported core operator ${condition.operator}`);
  }
}

function coreColumnSql(target: { column: string }): string {
  switch (target.column) {
    case 'name':
      return 'l.name';
    case 'phone':
      return 'l.phone';
    case 'email':
      return 'l.email';
    default:
      return 'l.created_at';
  }
}

/**
 * Status and Journey live on the process instance, so they filter through an
 * EXISTS rather than a column. `not_in` negates the whole existence test: a
 * Lead is excluded when any active membership matches.
 */
function processIdClause(condition: ResolvedCondition, params: Params, negate: boolean): string {
  const column =
    (condition.target as { column: string }).column === 'status'
      ? 'ps.current_status_id'
      : 'ps.journey_id';
  const ids = params.bind(condition.values.map(String), '::uuid[]');
  const exists = `EXISTS (SELECT 1 FROM process_instances ps WHERE ps.organization_id = l.organization_id AND ps.lead_id = l.id AND ps.active AND ${column} = ANY(${ids}))`;
  return negate ? `NOT ${exists}` : exists;
}

/** LIKE metacharacters in user input are data, not syntax. */
function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}
