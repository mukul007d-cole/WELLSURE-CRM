# ADR-0002: GST Number Is One-to-One With a Marketplace Account

**Status:** Accepted

**Decision:** One GST number maps to exactly one marketplace account/seller record. No many-to-many linking is required in V1.

**Consequences:** `gst_number` can be treated as a near-unique identifier for matching/deduplication (paired with phone for safety), both for migration and for day-to-day duplicate detection. If this assumption changes later (a business genuinely operating multiple stores under one GST), it requires a schema change to `marketplace_accounts` as a proper child table rather than a field on the lead — not a configuration change.
