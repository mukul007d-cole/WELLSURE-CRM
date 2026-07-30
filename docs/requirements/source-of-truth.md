# Source of Truth & Precedence

## Read this first — the single most important framing for this entire project

**Falcon is a configurable CRM engine, not a CRM built for one fixed process.**

Everywhere in these docs you will see specific data: three journeys named "Overlapping," "Private Label," and "SPN & BD"; specific statuses like "Pitch In Progress" or "Ready For Ungatting"; specific roles like "Sales Executive" or "Team Leader"; specific fields like `gst_number` or `hvs_tagging_status`.

**None of that is a hardcoded requirement.** It is real, real-world example data — pulled from Wellsure Solutions' actual current usage of their previous CRM (Cronberry) — used for exactly two purposes:

1. **To design the engine's capabilities against something real.** The field builder, journey/status builder, and permission system all need to be proven against genuine data shapes, not invented ones. If Wellsure's real data never needs a "linked account" field type, we wouldn't know to build one without seeing it.
2. **To seed the system on day one** so it isn't a genuinely empty, unusable shell at launch.

**The engine must be built so that every one of these examples could be deleted, renamed, or restructured entirely by an admin, through the UI, without touching code.** If any part of the implementation only works because a journey is literally named "Overlapping" or a field is literally named `gst_number`, that is a bug in the implementation, not a quirk of the data.

When in doubt while implementing: ask "would this still work if the admin renamed every journey, deleted this field, and invented three new statuses tomorrow morning?" If the answer is no, the code is too specific.

---

## Precedence order for resolving conflicts

1. **This documentation set** (`docs/`) — the reconciled, decision-gated baseline. Always wins over any raw source file.
2. **Approved decisions recorded in `docs/architecture/decisions/`** — supersede anything below if there's a conflict.
3. **Raw source material** (attribute spreadsheets, the real Cronberry export sample, the original implementation plan) — reference only, for cases this documentation hasn't yet addressed. Do not silently resolve a conflict between these — if the raw source contradicts something in `docs/`, stop and flag it rather than picking one.

---

## Confirmed decisions (do not re-litigate without a new ADR)

- Single **status** field per lead/seller — no separate stage+status split. See ADR-0001.
- One GST number maps to exactly one marketplace account. See ADR-0002.
- Finance V1 scope = invoices + payments/outstanding balances only (no renewal/payout engine, no accounting-system integration). See ADR-0003.
- Migration dedup priority: Cronberry `audience_id` → marketplace seller ID/`seller_merchant_token` → GST+phone → phone alone → manual review. See ADR-0004.
- Authentication provider is **not yet decided** (Cognito vs. Keycloak vs. custom). Do not build the auth module until this is resolved. See ADR-0005.
- A seller/lead may hold active membership in more than one Journey simultaneously; one may be marked primary for navigation/reporting.
- No separate generic Company/Account object in V1 — the Lead/Seller record is canonical.
- One user has exactly one active role. Exceptional access is handled via direct record grants, not a second role.
- The `pass` field and any plaintext credential data from the legacy export must never be migrated or stored anywhere in Falcon.
