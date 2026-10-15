# ADR-0027: Cronberry cutover deduplication (amends ADR-0004)

**Status:** Accepted (Phase 24). Amends ADR-0004 priorities 3–5.

## Context

ADR-0004 ranks matches as `audience_id` → marketplace seller id → GST + phone
→ phone alone → manual review. The real Amazon B2B export contradicts the
fourth rung: 225 phone numbers repeat, only 60 of those groups share a seller
name, and one number is attached to 11 different GST-registered businesses
(added by one person on one day — an agent's or accountant's number). ADR-0002
says a GST is one marketplace account, so merging on phone alone would fuse
distinct accounts. `audience_id` is unique per Cronberry *record*, and
Cronberry gives the same seller a new record in each category, so rung 1 never
matches across journeys either.

## Decision

1. Each Cronberry record becomes one Falcon process instance and, by default,
   its own lead. Within one journey, repeats stay separate leads — Cronberry's
   own "Override repeat rule" treated them as new leads, and Falcon's "Repeat
   lead" tab surfaces them for humans.
2. Records in **different journeys** merge into one multi-journey lead when the
   normalized phone matches **and** at least one of normalized name, email or
   GST matches, **and** the resulting group holds at most one record per
   journey. Field values are merged newest-record-first; every differing
   populated value is written to the report.
3. Phone-only matches, and groups with several records in one journey, are not
   merged; they are listed in the cutover report's review queue (ADR-0004's
   rung 5).
4. `audience_id` is kept per process instance as
   `process_instances.external_ref = 'cronberry:<audience_id>'` (a neutral,
   source-prefixed column — no Cronberry name in the schema) and is matched
   first on any re-run, which makes the cutover idempotent.

## Consequences

Counts reconcile exactly (`source = created + merged + rejected`), no two
GST-distinct accounts are ever fused, and the cost — a few genuine duplicates
left for review — is visible, bounded and reversible, where a wrong merge is
not.
