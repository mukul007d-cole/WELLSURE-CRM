import { describe, expect, it } from 'vitest';

import { ToolError } from '../tools/errors.js';
import {
  optionalText,
  parseInstructions,
  requireAllowedFile,
  requireResourceName,
  requireResourceType,
  requireResourceUrl,
  requireRoleIds,
} from '../tools/validation.js';

const pdfBytes = Buffer.from('%PDF-1.4\nsynthetic\n');

describe('tools validation', () => {
  it('requires a non-blank name, trimmed', () => {
    expect(requireResourceName('  Resource  ')).toBe('Resource');
    expect(() => requireResourceName('')).toThrow(ToolError);
    expect(() => requireResourceName('   ')).toThrow(ToolError);
    expect(() => requireResourceName(undefined)).toThrow(ToolError);
  });

  it('normalizes optional text to null when blank or absent', () => {
    expect(optionalText(undefined)).toBeNull();
    expect(optionalText(null)).toBeNull();
    expect(optionalText('  ')).toBeNull();
    expect(optionalText('  value  ')).toBe('value');
    expect(() => optionalText(42)).toThrow(ToolError);
  });

  it('accepts only the two documented resource types', () => {
    expect(requireResourceType('link')).toBe('link');
    expect(requireResourceType('file')).toBe('file');
    expect(() => requireResourceType('package')).toThrow(ToolError);
    expect(() => requireResourceType(undefined)).toThrow(ToolError);
  });

  it('requires an absolute http(s) URL — no mailto, unlike a document span href', () => {
    expect(requireResourceUrl('https://example.test/tool')).toBe('https://example.test/tool');
    expect(() => requireResourceUrl('mailto:a@example.test')).toThrow(ToolError);
    expect(() => requireResourceUrl('javascript:alert(1)')).toThrow(ToolError);
    expect(() => requireResourceUrl('not a url')).toThrow(ToolError);
  });

  it('parses instructions as a StructuredDocument, or accepts null/absent', () => {
    expect(parseInstructions(undefined)).toBeNull();
    expect(parseInstructions(null)).toBeNull();
    expect(parseInstructions({ blocks: [{ type: 'paragraph', spans: [{ text: 'hi' }] }] })).toEqual(
      { blocks: [{ type: 'paragraph', spans: [{ text: 'hi', marks: [] }] }] },
    );
    expect(() => parseInstructions({ blocks: 'nope' })).toThrow(ToolError);
  });

  it('normalizes and rejects duplicate roleIds for the visibility PUT body', () => {
    expect(requireRoleIds(['b', 'a'])).toEqual(['a', 'b']);
    expect(requireRoleIds([])).toEqual([]);
    expect(() => requireRoleIds(['a', 'a'])).toThrow(ToolError);
    expect(() => requireRoleIds(['a', ''])).toThrow(ToolError);
    expect(() => requireRoleIds('not-an-array')).toThrow(ToolError);
  });

  describe('requireAllowedFile — the closed-vocabulary file-type gate', () => {
    it('accepts a well-formed PDF: correct extension, MIME, and magic bytes', () => {
      expect(() =>
        requireAllowedFile({
          fileName: 'doc.pdf',
          mimeType: 'application/pdf',
          sizeBytes: pdfBytes.byteLength,
          body: pdfBytes,
        }),
      ).not.toThrow();
    });

    it('rejects a file over the size ceiling', () => {
      expect(() =>
        requireAllowedFile({
          fileName: 'doc.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 26 * 1024 * 1024,
          body: pdfBytes,
        }),
      ).toThrow(ToolError);
    });

    it('rejects a MIME type outside the allow-list — html, svg, and executables included', () => {
      for (const mimeType of ['text/html', 'image/svg+xml', 'application/x-msdownload']) {
        expect(() =>
          requireAllowedFile({
            fileName: 'file.bin',
            mimeType,
            sizeBytes: 10,
            body: Buffer.from('x'),
          }),
        ).toThrow(ToolError);
      }
    });

    it('rejects an extension that does not match the declared MIME type', () => {
      expect(() =>
        requireAllowedFile({
          fileName: 'doc.exe',
          mimeType: 'application/pdf',
          sizeBytes: pdfBytes.byteLength,
          body: pdfBytes,
        }),
      ).toThrow(ToolError);
    });

    it('rejects content whose magic bytes do not match its declared, allow-listed type', () => {
      const notActuallyPdf = Buffer.from('this is plain text, not a pdf');
      expect(() =>
        requireAllowedFile({
          fileName: 'doc.pdf',
          mimeType: 'application/pdf',
          sizeBytes: notActuallyPdf.byteLength,
          body: notActuallyPdf,
        }),
      ).toThrow(ToolError);
    });

    it('accepts a type with no reliable signature (csv/txt) on extension and MIME alone', () => {
      const csv = Buffer.from('a,b,c\n1,2,3\n');
      expect(() =>
        requireAllowedFile({
          fileName: 'data.csv',
          mimeType: 'text/csv',
          sizeBytes: csv.byteLength,
          body: csv,
        }),
      ).not.toThrow();
    });
  });
});
