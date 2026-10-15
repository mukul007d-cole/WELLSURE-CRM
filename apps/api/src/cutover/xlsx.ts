import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

/**
 * A deliberately small `.xlsx` reader: the first worksheet's cells as text.
 *
 * Why not a library: the legacy exports are generated with namespace-prefixed
 * SpreadsheetML (`<x:worksheet>`, `<x:c t="str">`) and no package-level
 * relationships part, which the common Node readers refuse outright. Reading
 * cell text is all the cutover needs, and doing it with `node:zlib` keeps the
 * API free of a production dependency for a one-time job.
 *
 * Supports stored and deflated zip entries, shared strings, inline strings and
 * `str`/number/boolean cells. Formulas are read from their cached value.
 */
export async function readXlsxRows(path: string): Promise<string[][]> {
  const zip = readZip(await readFile(path));
  const text = (name: string) => {
    const entry = zip.get(name);
    return entry === undefined ? undefined : entry.toString('utf8');
  };
  const workbook = text('xl/workbook.xml');
  if (workbook === undefined) throw new Error('not an xlsx workbook: xl/workbook.xml is missing');
  const sheetPath = firstSheetPath(workbook, text('xl/_rels/workbook.xml.rels'), zip);
  const sheet = text(sheetPath);
  if (sheet === undefined) throw new Error(`worksheet ${sheetPath} is missing`);
  const shared = parseSharedStrings(text('xl/sharedStrings.xml') ?? '');

  const rows: string[][] = [];
  for (const rowMatch of sheet.matchAll(
    /<(?:\w+:)?row\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g,
  )) {
    const cells: string[] = [];
    const body = rowMatch[1] ?? '';
    for (const cellMatch of body.matchAll(
      /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g,
    )) {
      const attributes = cellMatch[1] ?? '';
      const inner = cellMatch[2] ?? '';
      const reference = /\br="([A-Z]+)\d+"/.exec(attributes)?.[1];
      const index = reference === undefined ? cells.length : columnIndex(reference);
      const type = /\bt="(\w+)"/.exec(attributes)?.[1];
      cells[index] = cellValue(type, inner, shared);
    }
    rows.push(Array.from(cells, (cell) => cell ?? ''));
  }
  return rows;
}

function cellValue(type: string | undefined, inner: string, shared: readonly string[]): string {
  if (type === 'inlineStr') return textRuns(inner);
  const value = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner)?.[1];
  if (value === undefined) return '';
  if (type === 's') return shared[Number(value)] ?? '';
  if (type === 'b') return value === '1' ? 'true' : 'false';
  return decodeXml(value);
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((match) =>
    textRuns(match[1] ?? ''),
  );
}

/** Concatenates every `<t>` run (rich text keeps its text, loses its styling). */
function textRuns(xml: string): string {
  return [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)]
    .map((match) => decodeXml(match[1] ?? ''))
    .join('');
}

function firstSheetPath(
  workbook: string,
  rels: string | undefined,
  zip: Map<string, Buffer>,
): string {
  const relationshipId = /<(?:\w+:)?sheet\b[^>]*?\br:id="([^"]+)"/.exec(workbook)?.[1];
  if (relationshipId !== undefined && rels !== undefined) {
    const target = new RegExp(`<Relationship\\b[^>]*?Id="${relationshipId}"[^>]*?>`).exec(
      rels,
    )?.[0];
    const path = target === undefined ? undefined : /Target="([^"]+)"/.exec(target)?.[1];
    if (path !== undefined) return path.startsWith('/') ? path.slice(1) : `xl/${path}`;
  }
  const fallback = [...zip.keys()]
    .filter((name) => /^xl\/worksheets\/[^/]+\.xml$/.test(name))
    .sort()[0];
  if (fallback === undefined) throw new Error('the workbook has no worksheet');
  return fallback;
}

function columnIndex(letters: string): number {
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    return String.fromCodePoint(
      lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10),
    );
  });
}

/** Zip entries by name, via the central directory (sizes there are always right). */
function readZip(buffer: Buffer): Map<string, Buffer> {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('not a zip file');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('corrupt zip directory');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength).replace(/^\//, '');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(start, start + compressedSize);
    if (method === 0) entries.set(name, Buffer.from(data));
    else if (method === 8) entries.set(name, inflateRawSync(data));
    else throw new Error(`unsupported zip compression method ${method} for ${name}`);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
