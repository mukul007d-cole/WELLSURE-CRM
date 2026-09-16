import { describe, expect, it } from 'vitest';

import { checkFileType } from './file-type.js';

/** Uint8Array from an ASCII string — no Buffer/TextEncoder dependency (this package also runs in the browser). */
const ascii = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0));

const pdfBytes = ascii('%PDF-1.4\nrest of a pdf');
const maxBytes = 25 * 1024 * 1024;

describe('checkFileType', () => {
  it('accepts a well-formed PDF: correct extension, MIME, and magic bytes', () => {
    expect(
      checkFileType({
        fileName: 'doc.pdf',
        mimeType: 'application/pdf',
        sizeBytes: pdfBytes.byteLength,
        body: pdfBytes,
        maxBytes,
      }),
    ).toEqual({ ok: true });
  });

  it('rejects a file over the caller-supplied size ceiling', () => {
    const result = checkFileType({
      fileName: 'doc.pdf',
      mimeType: 'application/pdf',
      sizeBytes: maxBytes + 1,
      body: pdfBytes,
      maxBytes,
    });
    expect(result).toMatchObject({ ok: false, reason: 'too_large' });
  });

  it('rejects a MIME type outside the allow-list — html, svg, and executables included', () => {
    for (const mimeType of ['text/html', 'image/svg+xml', 'application/x-msdownload']) {
      const result = checkFileType({
        fileName: 'file.bin',
        mimeType,
        sizeBytes: 10,
        body: ascii('x'),
        maxBytes,
      });
      expect(result).toMatchObject({ ok: false, reason: 'type_not_permitted' });
    }
  });

  it('rejects an extension that does not match the declared MIME type', () => {
    const result = checkFileType({
      fileName: 'doc.exe',
      mimeType: 'application/pdf',
      sizeBytes: pdfBytes.byteLength,
      body: pdfBytes,
      maxBytes,
    });
    expect(result).toMatchObject({ ok: false, reason: 'extension_mismatch' });
  });

  it('rejects content whose magic bytes do not match its declared, allow-listed type — an executable masquerading as a PNG', () => {
    // The real Windows PE executable signature ('MZ'…), named and declared as a PNG.
    const peBytes = Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const result = checkFileType({
      fileName: 'invoice.png',
      mimeType: 'image/png',
      sizeBytes: peBytes.byteLength,
      body: peBytes,
      maxBytes,
    });
    expect(result).toMatchObject({ ok: false, reason: 'signature_mismatch' });
  });

  it('accepts a type with no reliable signature (csv/txt) on extension and MIME alone', () => {
    const csv = ascii('a,b,c\n1,2,3\n');
    expect(
      checkFileType({
        fileName: 'data.csv',
        mimeType: 'text/csv',
        sizeBytes: csv.byteLength,
        body: csv,
        maxBytes,
      }),
    ).toEqual({ ok: true });
  });

  it('checks size before type, so an oversized file is rejected without inspecting its content', () => {
    const result = checkFileType({
      fileName: 'huge.pdf',
      mimeType: 'application/pdf',
      sizeBytes: maxBytes + 1,
      body: ascii('not even a pdf'),
      maxBytes,
    });
    expect(result).toMatchObject({ ok: false, reason: 'too_large' });
  });
});
