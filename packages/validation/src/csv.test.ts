import { describe, expect, it } from 'vitest';

import type { CsvError } from './csv.js';
import {
  columnFillRate,
  columnSamples,
  isCsvError,
  parseCsv,
  toCsv,
  toCsvCell,
  toCsvRow,
} from './csv.js';

/**
 * The grammar, exhaustively. This parser sits where uploaded bytes are first
 * interpreted, so every case below is one a real export has produced.
 */
describe('parseCsv', () => {
  it('parses a plain file', () => {
    const table = parseCsv('name,phone\nAda,111\nGrace,222\n');
    expect(table.header).toEqual(['name', 'phone']);
    expect(table.rows).toEqual([
      { rowNumber: 2, cells: ['Ada', '111'] },
      { rowNumber: 3, cells: ['Grace', '222'] },
    ]);
    expect(table.raggedRowNumbers).toEqual([]);
  });

  it('accepts a file with no trailing newline', () => {
    expect(parseCsv('a,b\n1,2').rows).toEqual([{ rowNumber: 2, cells: ['1', '2'] }]);
  });

  it('reads CRLF line endings', () => {
    const table = parseCsv('a,b\r\n1,2\r\n3,4\r\n');
    expect(table.rows.map((row) => row.cells)).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('strips a UTF-8 BOM from the first header name', () => {
    expect(parseCsv('﻿name,phone\nAda,1\n').header).toEqual(['name', 'phone']);
  });

  it('keeps a comma inside a quoted field', () => {
    expect(parseCsv('a,b\n"one, two",3\n').rows[0]?.cells).toEqual(['one, two', '3']);
  });

  it('keeps a newline inside a quoted field, and the record number counts records', () => {
    const table = parseCsv('a,b\n"line one\nline two",3\nx,y\n');
    expect(table.rows[0]?.cells).toEqual(['line one\nline two', '3']);
    // Physically line 4, but record 3 — the number the mapping is keyed on.
    expect(table.rows[1]).toEqual({ rowNumber: 3, cells: ['x', 'y'] });
  });

  it('unescapes a doubled quote', () => {
    expect(parseCsv('a\n"she said ""hi"""\n').rows[0]?.cells).toEqual(['she said "hi"']);
  });

  it('treats a quote after content as literal, not as an opening quote', () => {
    expect(parseCsv('a\n5" pipe\n').rows[0]?.cells).toEqual(['5" pipe']);
  });

  it('drops trailing blank lines rather than reporting empty rows', () => {
    expect(parseCsv('a,b\n1,2\n\n\n').rows).toHaveLength(1);
  });

  it('trims header names but not cell values', () => {
    const table = parseCsv(' name , phone \n  Ada  ,1\n');
    expect(table.header).toEqual(['name', 'phone']);
    expect(table.rows[0]?.cells[0]).toBe('  Ada  ');
  });

  it('pads a short row and reports it as ragged rather than failing the file', () => {
    const table = parseCsv('a,b,c\n1,2\n1,2,3\n');
    expect(table.rows[0]?.cells).toEqual(['1', '2', '']);
    expect(table.raggedRowNumbers).toEqual([2]);
  });

  it('keeps the extra cells of a long row and reports it as ragged', () => {
    const table = parseCsv('a,b\n1,2,3\n');
    expect(table.rows[0]?.cells).toEqual(['1', '2', '3']);
    expect(table.raggedRowNumbers).toEqual([2]);
  });

  it.each([
    ['', 'empty_file'],
    ['name,phone\n', 'header_only'],
    ['a\n"never closed\n', 'unterminated_quote'],
    ['a,a\n1,2\n', 'duplicate_header'],
    ['a,,b\n1,2,3\n', 'blank_header'],
  ])('rejects %j with %s', (text, code) => {
    expect(() => parseCsv(text)).toThrowError(expect.objectContaining({ code }));
  });

  it('treats header names as case-insensitively duplicate', () => {
    expect(() => parseCsv('Name,name\n1,2\n')).toThrowError(
      expect.objectContaining({ code: 'duplicate_header' }),
    );
  });

  it('enforces the row limit', () => {
    const text = 'a\n' + '1\n'.repeat(4);
    expect(() => parseCsv(text, { maxRows: 3 })).toThrowError(
      expect.objectContaining({ code: 'too_many_rows' }),
    );
    expect(parseCsv(text, { maxRows: 4 }).rows).toHaveLength(4);
  });

  it('enforces the cell length limit', () => {
    expect(() => parseCsv(`a\n${'x'.repeat(11)}\n`, { maxCellLength: 10 })).toThrowError(
      expect.objectContaining({ code: 'cell_too_long' }),
    );
  });

  it('enforces the column limit', () => {
    expect(() => parseCsv('a,b,c,d\n1,2,3,4\n', { maxColumns: 3 })).toThrowError(
      expect.objectContaining({ code: 'row_too_wide' }),
    );
  });

  it('exposes a typed error guard', () => {
    try {
      parseCsv('');
      expect.unreachable('empty file should throw');
    } catch (error) {
      expect(isCsvError(error)).toBe(true);
      expect((error as CsvError).code).toBe('empty_file');
    }
  });
});

describe('column statistics', () => {
  const table = parseCsv('name,phone\nAda,111\nGrace,\nAda,333\nLin,   \n');

  it('samples distinct non-blank values in file order', () => {
    expect(columnSamples(table, 0, 3)).toEqual(['Ada', 'Grace', 'Lin']);
  });

  it('counts a whitespace-only cell as unfilled', () => {
    expect(columnFillRate(table, 1)).toBeCloseTo(0.5);
    expect(columnFillRate(table, 0)).toBe(1);
  });
});

describe('generation', () => {
  it.each([
    ['plain', 'plain'],
    ['has,comma', '"has,comma"'],
    ['has"quote', '"has""quote"'],
    ['has\nnewline', '"has\nnewline"'],
    ['has\r\nnewline', '"has\r\nnewline"'],
  ])('quotes %j as %j', (value, expected) => {
    expect(toCsvCell(value)).toBe(expected);
  });

  it('writes an empty field for null and undefined rather than the word', () => {
    expect(toCsvRow([null, undefined, ''])).toBe(',,');
  });

  it('stringifies numbers and booleans', () => {
    expect(toCsvRow([1, true, false, 0])).toBe('1,true,false,0');
  });

  it('emits CRLF-terminated records', () => {
    expect(toCsv(['a', 'b'], [['1', '2']])).toBe('a,b\r\n1,2\r\n');
  });

  it('round-trips every awkward value it can produce', () => {
    const values = ['plain', 'has,comma', 'has"quote', 'line\nbreak', '', '  spaced  '];
    // Two columns, because a one-column row holding only an empty value is a
    // blank line — see the next test. Export writes at least nine columns.
    const table = parseCsv(
      toCsv(
        ['v', 'keep'],
        values.map((value) => [value, 'x']),
      ),
    );
    expect(table.rows.map((row) => row.cells[0])).toEqual(values);
  });

  it('cannot represent a one-column row whose only value is empty', () => {
    // Inherent to the format: `\n` is both "a record of one empty field" and a
    // blank line, and dropping blank lines is what stops every spreadsheet
    // export's trailing newline reporting a spurious row. Pinned rather than
    // left to be discovered, because it bounds what round-tripping guarantees.
    expect(parseCsv(toCsv(['v'], [['a'], [''], ['b']])).rows.map((row) => row.cells[0])).toEqual([
      'a',
      'b',
    ]);
  });
});
