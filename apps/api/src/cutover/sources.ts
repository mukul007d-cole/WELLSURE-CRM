import { readXlsxRows } from './xlsx.js';

/**
 * Readers for the two kinds of source file the cutover takes. Both drop the
 * configured excluded columns at read time (D11) — an excluded value is never
 * copied into a row object, so it cannot reach a log, a report or the database.
 */

export interface SourceUser {
  name: string;
  email: string;
  roleName: string;
  active: boolean;
}

/**
 * The users list as copied out of the legacy user-management screen: a
 * serial-number line, the user's name, optional tag lines, then one
 * tab-separated line `email, role, level, status`.
 */
export function parseUsersFile(text: string): SourceUser[] {
  const lines = text.replaceAll('\r', '').split('\n');
  const users: SourceUser[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\d+\t?\s*$/.test(lines[index] ?? '')) continue;
    const extra: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length && !isRecordLine(lines[cursor] ?? '')) {
      const line = (lines[cursor] ?? '').trim();
      if (line !== '') extra.push(line);
      cursor += 1;
    }
    const parts = (lines[cursor] ?? '').split('\t').map((part) => part.trim());
    const name = extra[0];
    if (name === undefined || parts.length < 4) {
      index = cursor;
      continue;
    }
    users.push({
      name,
      email: parts[0]!.toLowerCase(),
      roleName: parts[1]!,
      active: parts[3]!.toLowerCase() === 'active',
    });
    index = cursor;
  }
  return users;
}

function isRecordLine(line: string): boolean {
  return line.includes('\t') && (line.split('\t')[0] ?? '').includes('@');
}

export type SourceRow = Record<string, string>;

/** The first worksheet as header-keyed string rows, excluded columns removed. */
export async function readWorkbook(
  path: string,
  excludedColumns: readonly string[],
): Promise<{ headers: string[]; rows: SourceRow[] }> {
  const [header = [], ...body] = await readXlsxRows(path);
  const excluded = new Set(excludedColumns.map((column) => column.toLowerCase()));
  const columns = header
    .map((name, index) => ({ index, header: name.trim() }))
    .filter((column) => column.header !== '' && !excluded.has(column.header.toLowerCase()));
  const rows: SourceRow[] = [];
  for (const cells of body) {
    if (cells.every((cell) => cell.trim() === '')) continue;
    const record: SourceRow = {};
    for (const column of columns) {
      const value = (cells[column.index] ?? '').trim();
      if (value !== '') record[column.header] = value;
    }
    rows.push(record);
  }
  return { headers: columns.map((column) => column.header), rows };
}
