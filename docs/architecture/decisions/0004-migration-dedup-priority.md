# ADR-0004: Migration Matching / Deduplication Priority

**Status:** Accepted

**Decision:** When migrating Cronberry data, match/deduplicate records in this order:

1. `audience_id` (Cronberry's internal record ID) — exact match
2. Marketplace seller ID / `seller_merchant_token`
3. `gst_number` + normalized phone
4. Normalized phone alone
5. Manual duplicate-review queue

See `docs/migration/cronberry-mapping.md` for full detail, including fields excluded from migration entirely (plaintext `pass` field, unused FCM token fields) and fields requiring reconciliation (real duplicate/typo columns in the source data).
