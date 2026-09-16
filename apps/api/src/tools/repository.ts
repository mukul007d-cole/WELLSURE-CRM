import type { StructuredDocument } from '@falcon/validation';

import type { Page, ResourceRow, ResourceType } from './types.js';

export interface ResourceCreateInput {
  id?: string;
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
  version?: number;
  createdById: string;
  updatedById: string;
}

export interface ResourceUpdateInput {
  name?: string;
  description?: string | null;
  category?: string | null;
  type?: ResourceType;
  url?: string | null;
  s3Key?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  instructions?: StructuredDocument | null;
  version?: number;
  updatedById: string;
}

export interface ResourceRepository {
  /**
   * `roleId: null` is admin mode — every Resource in the organization,
   * filtered only by `active`. A non-null `roleId` is browse mode — active
   * Resources joined against `resource_visibility` for that Role, so a
   * Resource with no grant row for the caller's Role is simply absent, the
   * same "no row = hidden" default `field_visibility` established.
   */
  list(
    org: string,
    filter: { roleId: string | null; active: boolean | undefined },
    page: number,
    pageSize: number,
  ): Promise<Page<ResourceRow>>;
  /** Raw, unfiltered by active state or visibility — callers apply those checks themselves. */
  findById(org: string, id: string): Promise<ResourceRow | null>;
  create(input: ResourceCreateInput): Promise<ResourceRow>;
  /** Null when the resource is not in the organization, so the route 404s. */
  update(org: string, id: string, input: ResourceUpdateInput): Promise<ResourceRow | null>;
  deactivate(org: string, id: string, actorUserId: string): Promise<ResourceRow | null>;
  /** How many of the given role ids are actually in this organization (inactive included). */
  countRolesInOrg(org: string, roleIds: readonly string[]): Promise<number>;
  /** Null when the resource is not in the organization, so the route 404s. */
  listVisibility(org: string, resourceId: string): Promise<string[] | null>;
  /** Null when the resource is not in the organization, so the route 404s. */
  replaceVisibility(
    org: string,
    actorUserId: string,
    resourceId: string,
    roleIds: readonly string[],
  ): Promise<string[] | null>;
}
