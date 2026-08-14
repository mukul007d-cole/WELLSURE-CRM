import { describe, expect, it } from 'vitest';

import { isImportError } from '../import/errors.js';
import {
  coerceCell,
  resolveStatusByLabel,
  validateMapping,
  type MappingContext,
} from '../import/mapping.js';
import { buildDuplicateQuery } from '../import/matching.js';
import type { ImportMapping } from '../import/types.js';

/**
 * The file-level decisions, without a database.
 *
 * Everything here is a check that would otherwise reject five thousand rows for
 * one reason, so it belongs to the mapping rather than to the row loop. What is
 * deliberately *absent* is any re-implementation of value validity — required
 * fields, patterns, lengths — because that is `validateFieldValues`' job and
 * duplicating it here is exactly the parallel validation path this phase exists
 * to avoid.
 */

const journeyId = 'j-1';
const context: MappingContext = {
  header: ['name', 'phone', 'company', 'size', 'owner', 'stage', 'junk'],
  fields: [
    { id: 'f-company', key: 'company', name: 'Company', fieldType: 'text' },
    { id: 'f-size', key: 'size', name: 'Size', fieldType: 'number' },
  ],
  statuses: [
    { id: 's-new', key: 'new_lead', name: 'New Lead' },
    { id: 's-won', key: 'won', name: 'Won' },
  ],
};

// `columns` is merged onto the defaults; every other key replaces. Spreading
// `overrides` wholesale would drop the defaults it is meant to extend.
const mapping = ({ columns, ...overrides }: Partial<ImportMapping> = {}): ImportMapping => ({
  journeyId,
  assignments: [],
  matchKeys: [],
  ...overrides,
  columns: {
    name: { kind: 'core', column: 'name' },
    phone: { kind: 'core', column: 'phone' },
    company: { kind: 'field', fieldId: 'f-company' },
    size: { kind: 'field', fieldId: 'f-size' },
    owner: { kind: 'assignment', assignmentType: 'owner' },
    stage: { kind: 'status' },
    junk: { kind: 'skip' },
    ...columns,
  },
});

const failure = (input: ImportMapping, ctx: MappingContext = context) => {
  try {
    validateMapping(input, ctx);
    return null;
  } catch (error) {
    return isImportError(error) ? error : null;
  }
};

describe('validateMapping', () => {
  it('resolves every target to a column index', () => {
    const resolved = validateMapping(mapping(), context);
    expect(resolved.nameIndex).toBe(0);
    expect(resolved.phoneIndex).toBe(1);
    expect(resolved.emailIndex).toBeNull();
    expect(resolved.statusColumnIndex).toBe(5);
    expect(resolved.fieldColumns).toEqual([
      { index: 2, fieldId: 'f-company', fieldType: 'text' },
      { index: 3, fieldId: 'f-size', fieldType: 'number' },
    ]);
    expect(resolved.assignmentColumns).toEqual([{ index: 4, assignmentType: 'owner' }]);
    expect(resolved.mappedFieldIds).toEqual(['f-company', 'f-size']);
    expect(resolved.assignmentTypes).toEqual(['owner']);
  });

  it('requires an explicit entry for every column, including skip', () => {
    const partial = mapping();
    const columns = { ...partial.columns };
    delete (columns as Record<string, unknown>).junk;
    expect(failure({ ...partial, columns })?.details).toEqual({ column: 'junk' });
  });

  it('rejects a mapping naming a column the file does not have', () => {
    const withGhost = mapping();
    const error = failure({
      ...withGhost,
      columns: { ...withGhost.columns, ghost: { kind: 'skip' } },
    });
    expect(error?.message).toContain('not in the file');
  });

  it.each([
    [
      'a Field that is not available on the journey',
      { company: { kind: 'field' as const, fieldId: 'f-missing' } },
    ],
    [
      'two columns on one core target',
      { phone: { kind: 'core' as const, column: 'name' as const } },
    ],
    ['two columns on one Field', { size: { kind: 'field' as const, fieldId: 'f-company' } }],
    ['a blank assignment type', { owner: { kind: 'assignment' as const, assignmentType: '  ' } }],
  ])('rejects %s', (_label, columns) => {
    expect(failure(mapping({ columns }))).not.toBeNull();
  });

  it('rejects a second status column', () => {
    const error = failure(mapping({ columns: { junk: { kind: 'status' } } as never }));
    expect(error?.message).toContain('same target');
  });

  it('requires the lead name', () => {
    const error = failure(mapping({ columns: { name: { kind: 'skip' } } as never }));
    expect(error?.message).toContain('lead name');
  });

  it('rejects a whole-file assignment that collides with a per-row column', () => {
    const error = failure(mapping({ assignments: [{ assignmentType: 'owner', userId: 'u-1' }] }));
    expect(error?.message).toContain('same target');
  });

  it('accepts a whole-file assignment of a different type', () => {
    const resolved = validateMapping(
      mapping({ assignments: [{ assignmentType: ' collaborator ', userId: ' u-1 ' }] }),
      context,
    );
    // Trimmed, because free-text assignment types are compared by value.
    expect(resolved.fileAssignments).toEqual([{ assignmentType: 'collaborator', userId: 'u-1' }]);
    expect(resolved.assignmentTypes).toEqual(['collaborator', 'owner']);
  });

  it('rejects a status column when the journey has no active statuses', () => {
    const error = failure(mapping(), { ...context, statuses: [] });
    expect(error?.message).toContain('no active statuses');
  });

  describe('match keys', () => {
    it('resolves a key to the column that writes its target', () => {
      const resolved = validateMapping(
        mapping({
          matchKeys: [
            { kind: 'core', column: 'phone' },
            { kind: 'field', fieldId: 'f-size' },
          ],
        }),
        context,
      );
      expect(resolved.matchKeys).toEqual([
        { kind: 'core', column: 'phone', index: 1 },
        { kind: 'field', fieldId: 'f-size', fieldType: 'number', index: 3 },
      ]);
    });

    it('rejects a key whose target nothing writes to', () => {
      // Silently matching every row against an empty value would mean "never a
      // duplicate", which is worse than refusing.
      const error = failure(mapping({ matchKeys: [{ kind: 'core', column: 'email' }] }));
      expect(error?.message).toContain('not mapped to any column');
    });
  });
});

describe('coerceCell', () => {
  it('treats a blank cell as "write nothing", distinct from an invalid value', () => {
    expect(coerceCell('text', '')).toBeUndefined();
    expect(coerceCell('text', '   ')).toBeUndefined();
    expect(coerceCell('number', '')).toBeUndefined();
  });

  it.each([
    ['number', '42', 42],
    ['number', ' -3.5 ', -3.5],
    ['boolean', 'yes', true],
    ['boolean', 'TRUE', true],
    ['boolean', '0', false],
    ['boolean', 'n', false],
    ['json', '{"a":1}', { a: 1 }],
    ['text', '  spaced  ', 'spaced'],
    ['date', '2026-01-31', '2026-01-31'],
  ])('coerces a %s cell %j', (fieldType, raw, expected) => {
    expect(coerceCell(fieldType, raw)).toEqual(expected);
  });

  it.each([
    ['number', 'abc'],
    ['number', '1,5'],
    ['boolean', 'maybe'],
    ['json', '{oops'],
  ])('rejects %s cell %j', (fieldType, raw) => {
    expect(() => coerceCell(fieldType, raw)).toThrowError();
  });

  it('passes an unknown field type through as text, for the real path to judge', () => {
    // A Field type added later must not be guessed at here; `validateValue`
    // rejects it with "unsupported field type", which is the honest answer.
    expect(coerceCell('some_future_type', 'value')).toBe('value');
  });
});

describe('resolveStatusByLabel', () => {
  it.each([
    ['New Lead', 's-new'],
    ['new lead', 's-new'],
    ['new_lead', 's-new'],
    ['  WON  ', 's-won'],
  ])('resolves %j by the admin’s own name or key', (label, id) => {
    expect(resolveStatusByLabel(context.statuses, label)?.id).toBe(id);
  });

  it.each(['', '   ', 'Nonexistent'])('returns null for %j', (label) => {
    expect(resolveStatusByLabel(context.statuses, label)).toBeNull();
  });
});

describe('buildDuplicateQuery', () => {
  const org = 'org-1';
  const phoneKey = { kind: 'core', column: 'phone', index: 1 } as const;
  const emailKey = { kind: 'core', column: 'email', index: 2 } as const;
  const fieldKey = { kind: 'field', fieldId: 'f-size', fieldType: 'number', index: 3 } as const;

  it('returns null when no keys are chosen, so matching is off', () => {
    expect(buildDuplicateQuery(org, [])).toBeNull();
  });

  it.each([[''], [null], [undefined]])(
    'returns null when a key value is %j, rather than matching every blank',
    (value) => {
      expect(buildDuplicateQuery(org, [{ key: phoneKey, value }])).toBeNull();
    },
  );

  it('lowercases both sides of an email comparison so the expression index is usable', () => {
    const query = buildDuplicateQuery(org, [{ key: emailKey, value: 'A@X.test' }]);
    expect(query?.text).toContain('lower(l.email) = lower($2)');
    expect(query?.values).toEqual([org, 'A@X.test']);
  });

  it('uses jsonb containment for a Field, which is the only indexed form', () => {
    const query = buildDuplicateQuery(org, [{ key: fieldKey, value: 42 }]);
    expect(query?.text).toContain('l.field_values @> $2::jsonb');
    expect(query?.values[1]).toBe(JSON.stringify({ 'f-size': 42 }));
  });

  it('ANDs several keys and binds every value as a parameter', () => {
    const query = buildDuplicateQuery(org, [
      { key: phoneKey, value: '123' },
      { key: fieldKey, value: 7 },
    ]);
    expect(query?.text).toContain('l.phone = $2 AND l.field_values @> $3::jsonb');
    expect(query?.values).toHaveLength(3);
    // Nothing is interpolated: the SQL text carries no value from the row.
    expect(query?.text).not.toContain('123');
  });

  it('breaks ties deterministically, so a preview and a commit name the same lead', () => {
    const query = buildDuplicateQuery(org, [{ key: phoneKey, value: '123' }]);
    expect(query?.text).toContain('ORDER BY l.created_at ASC, l.id ASC LIMIT 1');
  });

  it('only ever matches active leads', () => {
    expect(buildDuplicateQuery(org, [{ key: phoneKey, value: '1' }])?.text).toContain('l.active');
  });

  it('refuses a non-string core value rather than stringifying an object into the query', () => {
    expect(buildDuplicateQuery(org, [{ key: phoneKey, value: { nested: true } }])).toBeNull();
  });
});
