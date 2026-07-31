/**
 * V1 is single-tenant (per docs/requirements/source-of-truth.md), but the
 * login endpoint still requires organizationId in its body — there's no
 * subdomain/tenant derivation. This is the one fixed tenant for now.
 */
export const ORGANIZATION_ID = 'org-wellsure';

export const DEFAULT_PAGE_SIZE = 10;
