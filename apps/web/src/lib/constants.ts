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

/** Cards fetched per board column per page — kept small so a column loads fast. */
export const BOARD_PAGE_SIZE = 10;

/** Rows in the dashboard's "Recently updated" panel. */
export const DASHBOARD_RECENT_SIZE = 8;

/**
 * A journey's status list is admin-configured and unbounded. Past this many the
 * chart stops being readable (and the per-status count requests stop being
 * cheap), so we chart the first N by sortOrder and say so.
 */
export const MAX_CHARTED_STATUSES = 24;
