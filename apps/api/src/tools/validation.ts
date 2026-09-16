import {
  parseDocument,
  StructuredDocumentError,
  type StructuredDocument,
} from '@falcon/validation';

import { ToolError } from './errors.js';
import type { ResourceType } from './types.js';

export const resourceTypes = ['link', 'file'] as const satisfies readonly ResourceType[];

/** Refused above this, before anything is buffered or stored. Same ceiling as attachments. */
export const MAX_RESOURCE_FILE_BYTES = 25 * 1024 * 1024;

/**
 * A conservative allow-list, closing the gap ADR-0012 left open: the
 * Attachments feature never validated file type, only size, despite the
 * runbook naming both as non-negotiable (`docs/operations/runbook.md`). Keyed
 * by declared MIME type; each entry names the extensions it's expected to
 * pair with and, where the format has a reliable one, a magic-byte signature
 * checked against the actual uploaded bytes — declared MIME/extension alone
 * is client-asserted and trivially spoofable, so it is never the only check
 * for a binary format. Deliberately excludes HTML, SVG (XSS-capable even
 * served as an "image" in some browsers) and anything executable or
 * script-like. See docs/planning/phase-22-tools-resource-library.md §7.
 */
export interface FileTypeRule {
  extensions: readonly string[];
  /** Absent for formats with no reliable signature (plain text) — extension/size are the only checks then. */
  signature?: (bytes: Buffer) => boolean;
}

const zipSignature = (bytes: Buffer) =>
  bytes.length >= 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
const ole2Signature = (bytes: Buffer) =>
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
    signature: (b) => b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-',
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
    signature: (b) =>
      b.length >= 6 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')),
  },
  'text/csv': { extensions: ['csv'] },
  'text/plain': { extensions: ['txt'] },
};

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
}

/**
 * Validates a file upload against the allow-list before anything is written
 * to storage. Throws `ToolError('validation_error', …)` naming the reason —
 * the caller must reject the upload before any S3 `put` call.
 */
export function requireAllowedFile(input: {
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  body: Buffer;
}): void {
  if (input.sizeBytes > MAX_RESOURCE_FILE_BYTES)
    throw new ToolError('validation_error', 'file exceeds the maximum allowed size', {
      maxBytes: MAX_RESOURCE_FILE_BYTES,
    });
  const mimeType = (input.mimeType ?? '').toLowerCase();
  const rule = allowedFileTypes[mimeType];
  if (!rule)
    throw new ToolError('validation_error', 'file type is not permitted', {
      mimeType: input.mimeType,
    });
  const extension = extensionOf(input.fileName);
  if (!rule.extensions.includes(extension))
    throw new ToolError('validation_error', 'file extension does not match its declared type', {
      mimeType: input.mimeType,
      extension,
    });
  if (rule.signature && !rule.signature(input.body))
    throw new ToolError(
      'validation_error',
      'file contents do not match its declared type — the upload was rejected before being stored',
      { mimeType: input.mimeType },
    );
}

export function requireResourceName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new ToolError('validation_error', 'name is required');
  return value.trim();
}

export function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ToolError('validation_error', 'expected a string');
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function requireResourceType(value: unknown): ResourceType {
  if (typeof value !== 'string' || !(resourceTypes as readonly string[]).includes(value))
    throw new ToolError('validation_error', 'type must be one of link, file');
  return value as ResourceType;
}

const allowedUrlScheme = /^https?:\/\//i;

/** Resource links are http(s) only — no mailto:, unlike a document's span hrefs. */
export function requireResourceUrl(value: unknown): string {
  if (typeof value !== 'string' || !allowedUrlScheme.test(value))
    throw new ToolError('validation_error', 'url must be an absolute http(s) link');
  return value;
}

export function parseInstructions(value: unknown): StructuredDocument | null {
  if (value === undefined || value === null) return null;
  try {
    return parseDocument(value);
  } catch (error) {
    if (error instanceof StructuredDocumentError)
      throw new ToolError('validation_error', `instructions: ${error.message}`);
    throw error;
  }
}

/** `{ roleIds: string[] }` — the visibility PUT body. Array, non-blank, no duplicates, sorted. */
export function requireRoleIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || id === ''))
    throw new ToolError('validation_error', 'roleIds must be an array of IDs');
  const result = value.map((id) => String(id));
  if (new Set(result).size !== result.length)
    throw new ToolError('validation_error', 'duplicate roleId');
  return result.sort();
}
