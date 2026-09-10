/**
 * Generates the stable `key` identifiers admins used to type by hand for
 * every configuration entity (Journeys, Statuses, Fields, Services, Teams,
 * Departments, Roles, Notification Rules, Campaigns — see the "auto-generate
 * entity keys" plan). There are two variants of the `key` shape in the schema,
 * not one, and `slugify` has to satisfy the stricter of them:
 *
 * - `configKey` in `apps/api/src/admin/validation.ts` (Role, Department, Team):
 *   `^[a-z][a-z0-9_]*$` — a single letter is a valid key on its own.
 * - `requireConfigKey` in `apps/api/src/configuration/validation.ts` (Journey,
 *   Status, Field, Service), and the matching inline patterns in the
 *   notifications and campaigns services (Notification Rule, Campaign):
 *   `^[a-z][a-z0-9_]{1,62}$` — at least two characters.
 *
 * `slugify` always produces at least two characters so its output satisfies
 * both, rather than depending on which entity happens to be calling it.
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
 *
 * The result is always at least two characters. Two single-character cases
 * fall out of the rules above without help: an all-punctuation or non-Latin
 * name (Devanagari, Arabic, Tamil, Bengali, CJK — this product is deployed in
 * India, so this is a live path, not an edge case) collapses to the bare
 * placeholder letter `k`, and a genuinely one-letter name ("A") survives
 * as-is. Both used to be returned verbatim, which satisfied `configKey`'s
 * single-letter-is-fine pattern but not `requireConfigKey`'s (or the
 * notifications/campaigns services') minimum of two — so creating a Journey,
 * Status, Field, Service, Notification Rule, or Campaign with such a name
 * threw a 400 the admin had no way to work around, since they no longer
 * supply `key` themselves. Padding with a trailing `0` keeps a short result
 * short and legible rather than reaching for a longer, less obvious fallback.
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
  const withLeadingLetter = base === '' ? 'k' : /^[a-z]/.test(base) ? base : `k_${base}`;
  return withLeadingLetter.length >= 2 ? withLeadingLetter : `${withLeadingLetter}0`;
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
