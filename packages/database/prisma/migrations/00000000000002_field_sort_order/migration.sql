-- Field sort order — admin-controlled display order for Fields and, by
-- extension, Sections (a Section's position follows its first Field's).
--
-- Previously ordered only by `created_at` (`ConfigurationService.listFields`),
-- with no way for an admin to change it short of deactivating and recreating
-- Fields in a different order — unlike Statuses, which already have this via
-- `statuses.sort_order` / `reorderStatuses`. This mirrors that exactly.
--
-- Backfilled to match each organization's existing creation order, not left
-- at a flat default: every existing Field would otherwise tie at 0 and fall
-- back to sorting by id, silently reshuffling a live deployment's Field and
-- Section order the moment this migration lands.
ALTER TABLE fields ADD COLUMN sort_order integer NOT NULL DEFAULT 0;

WITH ordered AS (
  SELECT organization_id, id,
         ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY created_at, id) - 1 AS rank
  FROM fields
)
UPDATE fields
SET sort_order = ordered.rank
FROM ordered
WHERE fields.organization_id = ordered.organization_id AND fields.id = ordered.id;

CREATE INDEX fields_org_active_sort_idx ON fields (organization_id, active, sort_order);
