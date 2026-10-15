/**
 * The cutover configuration file (Phase 24, D13).
 *
 * Everything Wellsure-specific lives in this JSON file, never in code: journey,
 * status, field, role and department names are data here exactly as they are
 * data in the database. The script only knows the *shape* — "a journey has
 * statuses", "a role reports to roles" — so the same script can configure any
 * organization from any export with a different file.
 *
 * Every entity carries a stable `key` (snake_case) that the script matches on,
 * never a display name, so re-running after an admin renamed something in
 * Falcon updates nothing it should not and duplicates nothing.
 */

import { dataScopes, isPermissionPair, type DataScope } from '@falcon/permission-engine';

import { statusColors, supportedFieldTypes } from '../configuration/validation.js';

export interface CutoverConfig {
  version: 1;
  /** Prefix for `process_instances.external_ref`, e.g. "cronberry". */
  source: string;
  /** Assignment types the owner columns become (free text, like everywhere). */
  assignmentTypes: { owner: string; previousOwner: string };
  /** Domain for placeholder accounts of former owners — never deliverable. */
  placeholderEmailDomain: string;
  /** Role key former owners' inactive placeholder accounts get (D3). */
  placeholderRole: string;
  /** The exports' local UTC offset, e.g. "+05:30". Dates carry no zone. */
  sourceUtcOffset: string;
  /** Header names (or `fields[].sourceColumn`s) that are dropped at read time. */
  excludedColumns: string[];
  departments: Array<{ key: string; name: string }>;
  roles: RoleConfig[];
  fields: FieldConfig[];
  journeys: JourneyConfig[];
  /** How each export file's columns map onto the lead (column header names). */
  columns: ColumnConfig;
  /** Free-text decisions and open questions for the people reviewing the file. */
  notes?: string[];
}

export interface RoleConfig {
  key: string;
  name: string;
  /** The role name as the users file spells it. */
  sourceName: string;
  department?: string;
  reportsTo: string[];
  journeys: string[];
  permissions: Array<{
    module: string;
    action: string;
    scope: DataScope;
    /** Journey keys this grant is limited to (ADR-0026). Absent = all. */
    journeys?: string[];
  }>;
}

export interface FieldConfig {
  key: string;
  name: string;
  /** The export column holding this field's value. Absent = no data to migrate. */
  sourceColumn?: string;
  type: (typeof supportedFieldTypes)[number];
  options?: string[];
  section?: string;
  locked?: boolean;
  /** Journey keys the field is shown on, or "all". */
  journeys: string[] | 'all';
  /** Role keys that must not see the field at all. */
  hiddenForRoles?: string[];
  /** Role keys that see but cannot edit it. */
  viewOnlyForRoles?: string[];
  /** Role keys for which it is mandatory on lead creation; "all" = every role. */
  requiredOnCreateForRoles?: string[] | 'all';
}

export interface StatusConfig {
  key: string;
  name: string;
  /** Spellings of this status in the export (case-insensitive), besides `name`. */
  aliases?: string[];
  outcome: 'open' | 'closed_won' | 'closed_lost';
  behavior: 'default' | 'call_later' | 'follow_up' | 'archived';
  color?: (typeof statusColors)[number];
  isDefault?: boolean;
  /** Role keys; empty or absent = unrestricted. */
  allowedRoles?: string[];
  /** Field keys required to enter the status. */
  requiredFields?: string[];
  reasons?: string[];
  /** User names for round-robin auto-assignment on entry. */
  autoAssign?: string[];
}

export interface JourneyConfig {
  key: string;
  name: string;
  /** When true, only `members` (and nobody else) may work the journey. */
  restrictToMembers: boolean;
  /** User names, matched case-insensitively against the users file. */
  members: string[];
  statuses: StatusConfig[];
}

export interface ColumnConfig {
  externalId: string;
  name: string;
  phone: string;
  email: string;
  status: string;
  owner: string;
  previousOwner?: string;
  createdAt?: string;
  followUpAt?: string;
  remarks?: string;
  /** Extra phone columns kept only for duplicate matching (e.g. a GST column). */
  matchColumns?: { gst?: string };
}

export class CutoverConfigError extends Error {}

const keyPattern = /^[a-z][a-z0-9_]{1,62}$/;

/**
 * Structural validation plus every cross-reference: a status naming a role
 * that is not in `roles`, a field naming a journey that is not in `journeys`.
 * Errors are collected, not thrown one at a time, so one run shows them all.
 */
export function parseCutoverConfig(raw: unknown): CutoverConfig {
  const errors: string[] = [];
  const fail = (message: string) => errors.push(message);
  if (typeof raw !== 'object' || raw === null)
    throw new CutoverConfigError('config must be an object');
  const config = raw as CutoverConfig;
  if (config.version !== 1) fail('version must be 1');
  if (typeof config.source !== 'string' || !keyPattern.test(config.source))
    fail('source must be a snake_case key');
  for (const list of ['departments', 'roles', 'fields', 'journeys', 'excludedColumns'] as const)
    if (!Array.isArray(config[list])) fail(`${list} must be an array`);
  if (errors.length > 0) throw new CutoverConfigError(errors.join('\n'));

  const unique = (label: string, keys: string[]) => {
    for (const key of keys)
      if (!keyPattern.test(key)) fail(`${label} key "${key}" must be snake_case`);
    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) fail(`duplicate ${label} key "${key}"`);
      seen.add(key);
    }
    return seen;
  };
  const departments = unique(
    'department',
    config.departments.map((row) => row.key),
  );
  const roles = unique(
    'role',
    config.roles.map((row) => row.key),
  );
  const fields = unique(
    'field',
    config.fields.map((row) => row.key),
  );
  const journeys = unique(
    'journey',
    config.journeys.map((row) => row.key),
  );
  const known = (
    set: Set<string>,
    label: string,
    where: string,
    keys: readonly string[] | undefined,
  ) => {
    for (const key of keys ?? []) if (!set.has(key)) fail(`${where}: unknown ${label} "${key}"`);
  };

  for (const role of config.roles) {
    const where = `role ${role.key}`;
    if (role.department !== undefined) known(departments, 'department', where, [role.department]);
    known(roles, 'role', where, role.reportsTo);
    if (role.reportsTo.includes(role.key)) fail(`${where}: reports to itself`);
    known(journeys, 'journey', where, role.journeys);
    const pairs = new Set<string>();
    for (const permission of role.permissions) {
      if (!isPermissionPair(permission.module, permission.action))
        fail(`${where}: unknown permission ${permission.module}:${permission.action}`);
      if (!(dataScopes as readonly string[]).includes(permission.scope))
        fail(`${where}: unknown scope ${permission.scope}`);
      const pair = `${permission.module}:${permission.action}`;
      if (pairs.has(pair)) fail(`${where}: duplicate permission ${pair}`);
      pairs.add(pair);
      known(journeys, 'journey', `${where} ${pair}`, permission.journeys);
    }
  }

  for (const field of config.fields) {
    const where = `field ${field.key}`;
    if (!(supportedFieldTypes as readonly string[]).includes(field.type))
      fail(`${where}: unsupported type ${field.type}`);
    if ((field.type === 'select' || field.type === 'multi_select') && !field.options?.length)
      fail(`${where}: ${field.type} needs options`);
    if (field.journeys !== 'all') known(journeys, 'journey', where, field.journeys);
    known(roles, 'role', where, field.hiddenForRoles);
    known(roles, 'role', where, field.viewOnlyForRoles);
    if (field.requiredOnCreateForRoles !== 'all')
      known(roles, 'role', where, field.requiredOnCreateForRoles);
    if (config.excludedColumns.includes(field.sourceColumn ?? ''))
      fail(`${where}: reads an excluded column`);
  }

  for (const journey of config.journeys) {
    const where = `journey ${journey.key}`;
    const statusKeys = unique(
      `${where} status`,
      journey.statuses.map((row) => row.key),
    );
    void statusKeys;
    if (journey.statuses.filter((status) => status.isDefault === true).length !== 1)
      fail(`${where}: exactly one status must be the default`);
    const spellings = new Map<string, string>();
    for (const status of journey.statuses) {
      const sw = `${where} status ${status.key}`;
      if (!['open', 'closed_won', 'closed_lost'].includes(status.outcome))
        fail(`${sw}: bad outcome`);
      if (!['default', 'call_later', 'follow_up', 'archived'].includes(status.behavior))
        fail(`${sw}: bad behavior`);
      if (status.color !== undefined && !(statusColors as readonly string[]).includes(status.color))
        fail(`${sw}: unknown color ${status.color}`);
      known(roles, 'role', sw, status.allowedRoles);
      known(fields, 'field', sw, status.requiredFields);
      for (const spelling of [status.name, ...(status.aliases ?? [])]) {
        const normalized = spelling.trim().toLowerCase();
        const other = spellings.get(normalized);
        if (other !== undefined && other !== status.key)
          fail(`${where}: "${spelling}" names both ${other} and ${status.key}`);
        spellings.set(normalized, status.key);
      }
    }
    for (const fieldKey of journey.statuses.flatMap((status) => status.requiredFields ?? [])) {
      const field = config.fields.find((row) => row.key === fieldKey);
      if (field && field.journeys !== 'all' && !field.journeys.includes(journey.key))
        fail(`${where}: status requires field ${fieldKey}, which is not shown on the journey`);
    }
  }

  const columns = config.columns as ColumnConfig | undefined;
  if (!roles.has(config.placeholderRole))
    fail(`placeholderRole: unknown role "${config.placeholderRole}"`);
  if (!/^[+-]\d{2}:\d{2}$/.test(config.sourceUtcOffset ?? ''))
    fail('sourceUtcOffset must look like +05:30');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(config.placeholderEmailDomain ?? ''))
    fail('placeholderEmailDomain must be a domain');
  if (columns === undefined) fail('columns is required');
  else
    for (const key of ['externalId', 'name', 'phone', 'email', 'status', 'owner'] as const)
      if (typeof columns[key] !== 'string' || columns[key] === '')
        fail(`columns.${key} is required`);

  if (errors.length > 0) throw new CutoverConfigError(errors.join('\n'));
  return config;
}
