import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

import { afterAll, describe, expect, it } from 'vitest';

import { parseCutoverArgs } from '../cutover/cli.js';
import { CutoverConfigError, parseCutoverConfig } from '../cutover/config.js';
import {
  listValues,
  normalizeFieldValue,
  normalizePhone,
  parseRemarks,
  parseSourceDateTime,
  phoneKey,
} from '../cutover/normalize.js';
import { parseUsersFile, readWorkbook } from '../cutover/sources.js';

const exampleConfigPath = new URL(
  '../../../../docs/migration/cutover-config.example.json',
  import.meta.url,
);
const exampleConfig = async () =>
  JSON.parse(await readFile(exampleConfigPath, 'utf8')) as Record<string, unknown>;

const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
});

describe('cutover configuration', () => {
  it('accepts the committed example configuration', async () => {
    const config = parseCutoverConfig(await exampleConfig());
    expect(config.journeys.map((journey) => journey.key)).toEqual([
      'example_pipeline',
      'example_onboarding',
    ]);
  });

  it('reports every broken cross-reference at once', async () => {
    const raw = await exampleConfig();
    const roles = raw.roles as Array<Record<string, unknown>>;
    roles[1]!.reportsTo = ['invented_role'];
    const journeys = raw.journeys as Array<{ statuses: Array<Record<string, unknown>> }>;
    journeys[0]!.statuses[1]!.requiredFields = ['invented_field'];
    journeys[0]!.statuses[0]!.color = '#ff0000';
    try {
      parseCutoverConfig(raw);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CutoverConfigError);
      const message = (error as Error).message;
      expect(message).toContain('unknown role "invented_role"');
      expect(message).toContain('unknown field "invented_field"');
      expect(message).toContain('unknown color #ff0000');
    }
  });

  it('refuses a field that reads an excluded column', async () => {
    const raw = await exampleConfig();
    (raw.fields as Array<Record<string, unknown>>)[0]!.sourceColumn = 'pass';
    expect(() => parseCutoverConfig(raw)).toThrow(/reads an excluded column/);
  });

  it('parses the command line, dry run by default', () => {
    expect(
      parseCutoverArgs([
        '--',
        '--config',
        'c.json',
        '--export',
        'example_pipeline=a=b.xlsx',
        '--actor-email',
        'Admin@Example.Test',
      ]),
    ).toMatchObject({
      configPath: 'c.json',
      exports: [{ journeyKey: 'example_pipeline', path: 'a=b.xlsx' }],
      actorEmail: 'admin@example.test',
      commit: false,
    });
    expect(() => parseCutoverArgs(['--config', 'c.json'])).toThrow(/actor-email/);
    expect(() =>
      parseCutoverArgs(['--config', 'c', '--actor-email', 'a@b.c', '--send-invites']),
    ).toThrow(/needs --commit/);
  });
});

describe('cutover normalization', () => {
  it('normalizes phones, dates and bracketed dropdown values', () => {
    expect(normalizePhone("'98765 43210")).toBe('9876543210');
    expect(phoneKey('+919876543210')).toBe('9876543210');
    expect(listValues('[Gold, Silver]')).toEqual(['Gold', 'Silver']);
    expect(listValues('[]')).toEqual([]);
    expect(parseSourceDateTime('2026-07-03 15:58:13', '+05:30')?.toISOString()).toBe(
      '2026-07-03T10:28:13.000Z',
    );
  });

  it('types values by field type and explains what it cannot store', () => {
    const select = {
      key: 'tier',
      name: 'Tier',
      type: 'select' as const,
      options: ['Gold', 'Silver'],
      journeys: 'all' as const,
    };
    expect(normalizeFieldValue(select, '[gold]', '+00:00')).toEqual({ ok: true, value: 'Gold' });
    expect(normalizeFieldValue(select, 'Bronze', '+00:00')).toEqual({
      ok: false,
      reason: 'not one of the options',
    });
    const multi = { ...select, type: 'multi_select' as const };
    expect(normalizeFieldValue(multi, '[Gold, Silver]', '+00:00')).toEqual({
      ok: true,
      value: ['Gold', 'Silver'],
    });
    const number = { ...select, type: 'number' as const, options: [] };
    expect(normalizeFieldValue(number, '1,250', '+00:00')).toEqual({ ok: true, value: 1250 });
    expect(normalizeFieldValue(number, 'abc', '+00:00')).toMatchObject({ ok: false });
    const date = { ...select, type: 'date' as const, options: [] };
    expect(normalizeFieldValue(date, '2026-08-10 00:00:00', '+00:00')).toEqual({
      ok: true,
      value: '2026-08-10',
    });
  });

  it('splits remarks into dated, attributed lines', () => {
    expect(
      parseRemarks(
        '2026-07-03 15:58:13 :- Called, will revert &amp; share (Example Person)<br/>2026-07-04 10:00:00 :- No answer (Someone Else)<br/>',
        '+05:30',
      ),
    ).toEqual([
      {
        at: new Date('2026-07-03T10:28:13.000Z'),
        text: 'Called, will revert & share',
        actorName: 'Example Person',
      },
      { at: new Date('2026-07-04T04:30:00.000Z'), text: 'No answer', actorName: 'Someone Else' },
    ]);
  });
});

describe('cutover source files', () => {
  it('reads the copied users list, including tag lines and blocked users', () => {
    const users = parseUsersFile(
      [
        '1\t',
        'Example Person',
        'example.person@example.test\tExample Executive\t3\tActive',
        '2\t',
        'Example Other',
        'Deactivated',
        'EXAMPLE.other@example.test\tExample Manager\t1\tBlocked',
      ].join('\n'),
    );
    expect(users).toEqual([
      {
        name: 'Example Person',
        email: 'example.person@example.test',
        roleName: 'Example Executive',
        active: true,
      },
      {
        name: 'Example Other',
        email: 'example.other@example.test',
        roleName: 'Example Manager',
        active: false,
      },
    ]);
  });

  it('reads namespace-prefixed worksheets and drops excluded columns at read time', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'falcon-cutover-'));
    directories.push(directory);
    const path = join(directory, 'export.xlsx');
    const ns = 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
    const cell = (ref: string, value: string) =>
      `<x:c r="${ref}" t="str"><x:v>${value}</x:v></x:c>`;
    await writeFile(
      path,
      zip({
        'xl/workbook.xml': `<x:workbook ${ns}><x:sheets><x:sheet name="Leads" sheetId="1" r:id="R1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></x:sheets></x:workbook>`,
        'xl/_rels/workbook.xml.rels':
          '<Relationships><Relationship Type="worksheet" Target="/xl/worksheets/sheet1.xml" Id="R1"/></Relationships>',
        'xl/worksheets/sheet1.xml': `<x:worksheet ${ns}><x:sheetData><x:row r="1">${cell('A1', 'record_id')}${cell('B1', 'pass')}${cell('C1', 'name')}</x:row><x:row r="2">${cell('A2', '101')}${cell('B2', 'secret-value')}${cell('C2', 'Example &amp; Co')}</x:row><x:row r="3">${cell('A3', '102')}<x:c r="C3"><x:v>7</x:v></x:c></x:row></x:sheetData></x:worksheet>`,
      }),
    );
    const { headers, rows } = await readWorkbook(path, ['pass']);
    expect(headers).toEqual(['record_id', 'name']);
    expect(rows).toEqual([
      { record_id: '101', name: 'Example & Co' },
      { record_id: '102', name: '7' },
    ]);
    expect(JSON.stringify(rows)).not.toContain('secret-value');
  });
});

/** A minimal deflate zip writer, so the reader is tested against a real archive. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(content, 'utf8'));
    const nameBuffer = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(Buffer.byteLength(content), 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(Buffer.byteLength(content), 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuffer, data);
    centrals.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
