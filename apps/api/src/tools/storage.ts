import { sanitizeFileName } from '../attachments/storage.js';

/**
 * Where a Resource's file lives.
 *
 * Deliberately not `attachments/storage.ts`'s `objectKey` — that scheme is
 * lead-shaped (`org/{orgId}/leads/{leadId}/{attachmentId}/…`) and a Resource
 * has no lead. Only `sanitizeFileName` is shared, since it has no lead-
 * specific logic either.
 *
 * `version` (not a fresh random id) is what keeps two uploads for the same
 * Resource from colliding: a Resource has exactly one current file, edited in
 * place rather than versioned as separate rows (see
 * docs/planning/phase-22-tools-resource-library.md §11), so the key has to
 * change on every replace or a same-named re-upload would silently overwrite
 * the object an in-flight download might still be streaming. `version`
 * already increments on every write, so it doubles as that uniqueifier for
 * free.
 */
export function resourceObjectKey(input: {
  organizationId: string;
  resourceId: string;
  version: number;
  fileName: string;
}): string {
  return `org/${input.organizationId}/tools/${input.resourceId}/${input.version}/${sanitizeFileName(input.fileName)}`;
}
