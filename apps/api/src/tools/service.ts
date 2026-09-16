import { randomUUID } from 'node:crypto';

import type { AttachmentStorage } from '../storage/object-storage.js';
import { ToolError } from './errors.js';
import type { ResourceRepository } from './repository.js';
import { resourceObjectKey } from './storage.js';
import type { Page, ResourceFileInput, ResourceMetadataInput, ResourceRow } from './types.js';

export class ResourceService {
  constructor(
    private readonly repository: ResourceRepository,
    /** Undefined when object storage isn't configured — link-type Resources still work. */
    private readonly storage: AttachmentStorage | undefined,
  ) {}

  list(input: {
    organizationId: string;
    roleId: string | null;
    active: boolean | undefined;
    page: number;
    pageSize: number;
  }): Promise<Page<ResourceRow>> {
    return this.repository.list(
      input.organizationId,
      { roleId: input.roleId, active: input.active },
      input.page,
      input.pageSize,
    );
  }

  get(organizationId: string, resourceId: string): Promise<ResourceRow | null> {
    return this.repository.findById(organizationId, resourceId);
  }

  /**
   * Store the object before the row, matching `AttachmentService.upload`'s
   * discipline exactly: a crash between the two strands an object in the
   * bucket (waste, invisible) rather than a row pointing at nothing (a
   * download that 500s and a document the admin believes exists).
   */
  async create(input: {
    organizationId: string;
    actorUserId: string;
    metadata: ResourceMetadataInput;
    file: ResourceFileInput | null;
    sortOrder: number;
  }): Promise<ResourceRow> {
    if (input.metadata.type === 'link') {
      return this.repository.create({
        organizationId: input.organizationId,
        name: input.metadata.name,
        description: input.metadata.description,
        category: input.metadata.category,
        type: 'link',
        url: input.metadata.url,
        s3Key: null,
        fileName: null,
        mimeType: null,
        sizeBytes: null,
        instructions: input.metadata.instructions,
        sortOrder: input.sortOrder,
        createdById: input.actorUserId,
        updatedById: input.actorUserId,
      });
    }
    if (input.file === null)
      throw new ToolError('validation_error', 'a file is required when type is file');
    const resourceId = randomUUID();
    const version = 1;
    const key = resourceObjectKey({
      organizationId: input.organizationId,
      resourceId,
      version,
      fileName: input.file.fileName,
    });
    await this.requireStorage().put({
      key,
      body: input.file.body,
      contentType: input.file.mimeType ?? undefined,
    });
    return this.repository.create({
      id: resourceId,
      organizationId: input.organizationId,
      name: input.metadata.name,
      description: input.metadata.description,
      category: input.metadata.category,
      type: 'file',
      url: null,
      s3Key: key,
      fileName: input.file.fileName,
      mimeType: input.file.mimeType,
      sizeBytes: input.file.body.byteLength,
      instructions: input.metadata.instructions,
      sortOrder: input.sortOrder,
      version,
      createdById: input.actorUserId,
      updatedById: input.actorUserId,
    });
  }

  /**
   * A plain overwrite, not a version history — deliberately, matching this
   * project's own accepted, never-completed Attachment versioning story
   * (ADR-0012). The row's `version` still increments on every edit (matching
   * Team/Department/Role's own convention) and doubles as the S3 key's
   * uniqueifier for a file replacement, so a same-named re-upload can never
   * collide with — and silently corrupt — an in-flight download of the file
   * it's replacing.
   */
  async update(input: {
    organizationId: string;
    actorUserId: string;
    resourceId: string;
    metadata: ResourceMetadataInput;
    /** Present only when the caller is replacing the file; absent keeps the existing one. */
    file: ResourceFileInput | null;
  }): Promise<ResourceRow> {
    const old = await this.repository.findById(input.organizationId, input.resourceId);
    if (old === null) throw new ToolError('not_found', 'resource not found');
    const nextVersion = old.version + 1;
    let fileFields: {
      s3Key?: string | null;
      fileName?: string | null;
      mimeType?: string | null;
      sizeBytes?: number | null;
      version?: number;
    } = {};
    if (input.metadata.type === 'link') {
      fileFields = { s3Key: null, fileName: null, mimeType: null, sizeBytes: null };
    } else if (input.file !== null) {
      const key = resourceObjectKey({
        organizationId: input.organizationId,
        resourceId: input.resourceId,
        version: nextVersion,
        fileName: input.file.fileName,
      });
      await this.requireStorage().put({
        key,
        body: input.file.body,
        contentType: input.file.mimeType ?? undefined,
      });
      fileFields = {
        s3Key: key,
        fileName: input.file.fileName,
        mimeType: input.file.mimeType,
        sizeBytes: input.file.body.byteLength,
        version: nextVersion,
      };
    } else if (old.type !== 'file') {
      // Switching link -> file with no upload attached is caller error.
      throw new ToolError('validation_error', 'a file is required when type is file');
    }
    const row = await this.repository.update(input.organizationId, input.resourceId, {
      name: input.metadata.name,
      description: input.metadata.description,
      category: input.metadata.category,
      type: input.metadata.type,
      url: input.metadata.type === 'link' ? input.metadata.url : null,
      instructions: input.metadata.instructions,
      updatedById: input.actorUserId,
      ...fileFields,
    });
    if (row === null) throw new ToolError('not_found', 'resource not found');
    // Best-effort: only when the object actually changed underneath the row.
    // A metadata-only edit of an existing file resource leaves s3Key
    // unchanged, so this is a no-op in the common case.
    if (old.s3Key !== null && old.s3Key !== row.s3Key) {
      try {
        await this.requireStorage().remove(old.s3Key);
      } catch {
        // The row already points at the new object (or none); a stranded old
        // object is a cleanup job's problem, not the caller's error — the same
        // reasoning AttachmentService.remove uses.
      }
    }
    return row;
  }

  async deactivate(
    organizationId: string,
    actorUserId: string,
    resourceId: string,
  ): Promise<ResourceRow> {
    const row = await this.repository.deactivate(organizationId, resourceId, actorUserId);
    if (row === null) throw new ToolError('not_found', 'resource not found');
    return row;
  }

  download(
    resource: ResourceRow,
  ): Promise<{ body: NodeJS.ReadableStream; contentType?: string | undefined }> {
    if (resource.type !== 'file' || resource.s3Key === null)
      throw new ToolError('validation_error', 'resource has no downloadable file');
    return this.requireStorage().get(resource.s3Key);
  }

  listVisibility(organizationId: string, resourceId: string): Promise<string[] | null> {
    return this.repository.listVisibility(organizationId, resourceId);
  }

  async replaceVisibility(input: {
    organizationId: string;
    actorUserId: string;
    resourceId: string;
    roleIds: string[];
  }): Promise<string[]> {
    const count = await this.repository.countRolesInOrg(input.organizationId, input.roleIds);
    if (count !== input.roleIds.length)
      throw new ToolError('validation_error', 'one or more roles are outside the organization');
    const result = await this.repository.replaceVisibility(
      input.organizationId,
      input.actorUserId,
      input.resourceId,
      input.roleIds,
    );
    if (result === null) throw new ToolError('not_found', 'resource not found');
    return result;
  }

  private requireStorage(): AttachmentStorage {
    if (!this.storage)
      throw new ToolError('storage_not_configured', 'object storage is not configured');
    return this.storage;
  }
}
