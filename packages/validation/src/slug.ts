/**
 * Generates the stable `key` identifiers admins used to type by hand for
 * every configuration entity (Journeys, Statuses, Fields, Services, Teams,
 * Departments, Roles, Notification Rules, Campaigns — see the "auto-generate
 * entity keys" plan). Every one of those tables enforces the same
 * `^[a-z][a-z0-9_]+$` shape (`configKey` in `apps/api/src/admin/validation.ts`,
 * `requireConfigKey` in `apps/api/src/configuration/validation.ts`, and the
 * matching inline patterns in the notifications and campaigns services), so
 * `slugify` targets that one shape rather than inventing a second convention.
 *
 * Callers still own uniqueness: `key` is unique per-organization for most
 * entities but scoped further for a few (Status is unique per Journey, Team
 * per Department). `nextAvailableKey` takes an `exists` predicate so each
 * caller can check its own scope without this module knowing about it.
 */

/** Keeps generated keys well under every `key` column's practical length. */
const MAX_BASE_LENGTH = 54;

/**
 * Turns a human-entered name into a candidate key: lowercase, non-alphanumeric
 * runs collapsed to a single underscore, and — because the shared key pattern
 * requires a leading letter — a `k_` prefix on anything that would otherwise
 * start with a digit or be empty (a name that is entirely punctuation or
 * non-Latin script, for instance).
 */
export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents so "Café" -> "cafe", not "caf"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/_+$/g, '');
  if (base === '') return 'k';
  return /^[a-z]/.test(base) ? base : `k_${base}`;
}

/**
 * Appends `_2`, `_3`, … to `slugify(name)` until `exists` reports the
 * candidate is free. The suffix is an underscore, not a hyphen, so every
 * candidate stays valid against the shared key pattern above.
 *
 * `exists` is called sequentially and awaited each time rather than probed in
 * parallel: collisions are rare (most names are unique on first try) and the
 * caller typically runs this inside a transaction, where serialized reads are
 * the point.
 */
export async function nextAvailableKey(
  name: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  for (let suffix = 2; await exists(candidate); suffix += 1) {
    candidate = `${base}_${suffix}`;
  }
  return candidate;
}
