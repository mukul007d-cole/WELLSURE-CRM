/**
 * A conservative file-type allow-list: declared MIME type, the extension(s)
 * it is expected to pair with, and — for every binary format with a
 * reliable one — a magic-byte signature checked against the actual
 * uploaded bytes. Declared MIME/extension alone is client-asserted and
 * trivially spoofable, so it is never the only check for a binary format.
 * Deliberately excludes HTML, SVG (XSS-capable even served as an "image" in
 * some browsers) and anything executable or script-like.
 *
 * `Uint8Array` rather than Node's `Buffer` throughout: this package is also
 * consumed by `apps/web` (see `mocks/handlers.ts`), so nothing in it may
 * depend on a Node-only API. A `Buffer` already satisfies `Uint8Array`, so
 * every Node-side caller passes one in unchanged.
 *
 * Built for the Tools resource library (`docs/planning/phase-22-tools-resource-library.md`
 * §7, ADR-0024) and relocated here, unchanged in behavior, once Attachments —
 * the older, sibling document-upload feature ADR-0024 found had never gained
 * a file-type check at all — became a second, unrelated caller needing the
 * identical model. Each caller keeps its own size ceiling and its own error
 * type; only the allow-list and the check itself are shared, so a future
 * change to what is permitted lands on both upload paths at once and cannot
 * land on only one.
 */

export interface FileTypeRule {
  extensions: readonly string[];
  /** Absent for formats with no reliable signature (plain text) — extension/size are the only checks then. */
  signature?: (bytes: Uint8Array) => boolean;
}

/** True when `bytes` starts with `text`, compared byte-for-byte against its ASCII codes. */
function startsWithAscii(bytes: Uint8Array, text: string): boolean {
  if (bytes.length < text.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

const zipSignature = (bytes: Uint8Array) =>
  bytes.length >= 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
const ole2Signature = (bytes: Uint8Array) =>
  bytes.length >= 8 &&
  bytes[0] === 0xd0 &&
  bytes[1] === 0xcf &&
  bytes[2] === 0x11 &&
  bytes[3] === 0xe0 &&
  bytes[4] === 0xa1 &&
  bytes[5] === 0xb1 &&
  bytes[6] === 0x1a &&
  bytes[7] === 0xe1;

export const allowedFileTypes: Record<string, FileTypeRule> = {
  'application/pdf': {
    extensions: ['pdf'],
    signature: (b) => startsWithAscii(b, '%PDF-'),
  },
  'application/msword': { extensions: ['doc'], signature: ole2Signature },
  'application/vnd.ms-excel': { extensions: ['xls'], signature: ole2Signature },
  'application/vnd.ms-powerpoint': { extensions: ['ppt'], signature: ole2Signature },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    extensions: ['docx'],
    signature: zipSignature,
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    extensions: ['xlsx'],
    signature: zipSignature,
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    extensions: ['pptx'],
    signature: zipSignature,
  },
  'application/zip': { extensions: ['zip'], signature: zipSignature },
  'application/x-zip-compressed': { extensions: ['zip'], signature: zipSignature },
  'image/png': {
    extensions: ['png'],
    signature: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  'image/jpeg': {
    extensions: ['jpg', 'jpeg'],
    signature: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  'image/gif': {
    extensions: ['gif'],
    signature: (b) => startsWithAscii(b, 'GIF87a') || startsWithAscii(b, 'GIF89a'),
  },
  'text/csv': { extensions: ['csv'] },
  'text/plain': { extensions: ['txt'] },
};

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
}

export type FileTypeCheckResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'too_large' | 'type_not_permitted' | 'extension_mismatch' | 'signature_mismatch';
      message: string;
      details: Record<string, unknown>;
    };

/**
 * Checks a file upload against `allowedFileTypes` and the caller's own size
 * ceiling. Returns a result rather than throwing — each caller wraps this in
 * whatever error convention its own module uses, and must call it before
 * anything is written to storage.
 */
export function checkFileType(input: {
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  body: Uint8Array;
  maxBytes: number;
}): FileTypeCheckResult {
  if (input.sizeBytes > input.maxBytes) {
    return {
      ok: false,
      reason: 'too_large',
      message: 'file exceeds the maximum allowed size',
      details: { maxBytes: input.maxBytes },
    };
  }
  const mimeType = (input.mimeType ?? '').toLowerCase();
  const rule = allowedFileTypes[mimeType];
  if (!rule) {
    return {
      ok: false,
      reason: 'type_not_permitted',
      message: 'file type is not permitted',
      details: { mimeType: input.mimeType },
    };
  }
  const extension = extensionOf(input.fileName);
  if (!rule.extensions.includes(extension)) {
    return {
      ok: false,
      reason: 'extension_mismatch',
      message: 'file extension does not match its declared type',
      details: { mimeType: input.mimeType, extension },
    };
  }
  if (rule.signature && !rule.signature(input.body)) {
    return {
      ok: false,
      reason: 'signature_mismatch',
      message:
        'file contents do not match its declared type — the upload was rejected before being stored',
      details: { mimeType: input.mimeType },
    };
  }
  return { ok: true };
}
