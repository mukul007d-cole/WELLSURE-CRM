import type { StructuredDocument } from '@falcon/validation';

export type ResourceType = 'link' | 'file';

export interface ResourceRow {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  category: string | null;
  type: ResourceType;
  url: string | null;
  s3Key: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  instructions: StructuredDocument | null;
  sortOrder: number;
  active: boolean;
  version: number;
  createdById: string | null;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceMetadataInput {
  name: string;
  description: string | null;
  category: string | null;
  type: ResourceType;
  /** Required when type = link; ignored when type = file. */
  url: string | null;
  instructions: StructuredDocument | null;
}

export interface ResourceFileInput {
  fileName: string;
  mimeType: string | null;
  body: Buffer;
}

export interface PageRequest {
  page: number;
  pageSize: number;
}
export interface Page<T> extends PageRequest {
  total: number;
  items: T[];
}
