/**
 * V1 is single-tenant (per docs/requirements/source-of-truth.md), but the
 * login endpoint still requires organizationId in its body — there's no
 * subdomain/tenant derivation. This is the one fixed tenant for now.
 */
const organizationId: unknown = import.meta.env.VITE_FALCON_ORGANIZATION_ID;
if (typeof organizationId !== 'string' || !organizationId) {
  throw new Error('VITE_FALCON_ORGANIZATION_ID is required');
}
export const ORGANIZATION_ID = organizationId;

export const DEFAULT_PAGE_SIZE = 10;
