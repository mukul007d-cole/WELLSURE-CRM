import {
  checkFileType,
  parseDocument,
  StructuredDocumentError,
  type StructuredDocument,
} from '@falcon/validation';

import { ToolError } from './errors.js';
import type { ResourceType } from './types.js';

export const resourceTypes = ['link', 'file'] as const satisfies readonly ResourceType[];

/** Refused above this, before anything is buffered or stored. Same ceiling as attachments. */
export const MAX_RESOURCE_FILE_BYTES = 25 * 1024 * 1024;

// The allow-list and the check itself live in `@falcon/validation`'s
// `file-type.ts` — see that module's doc comment for why, and
// ADR-0024/docs/planning/phase-22-tools-resource-library.md §7 for the
// original decision.
export { allowedFileTypes, type FileTypeRule } from '@falcon/validation';

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
  const result = checkFileType({ ...input, maxBytes: MAX_RESOURCE_FILE_BYTES });
  if (!result.ok) throw new ToolError('validation_error', result.message, result.details);
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
