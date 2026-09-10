-- Rollback for 00000000000002_field_sort_order.
DROP INDEX IF EXISTS fields_org_active_sort_idx;
ALTER TABLE fields DROP COLUMN IF EXISTS sort_order;
