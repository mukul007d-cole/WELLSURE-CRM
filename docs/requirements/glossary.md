# Canonical Glossary

Use these definitions consistently across code, docs, and UI copy. Raw source files use "stage," "status," "process," and "business model" inconsistently — this table is the resolved version.

| Term | Canonical meaning | Note |
|---|---|---|
| Organization | Wellsure's tenant / top-level data boundary | Schema includes `organization_id` for future portability; V1 is single-tenant |
| User | A person who can log in | |
| Role | One admin-defined, fully configurable permission profile | Not a fixed preset — see `docs/permissions/access-model.md` |
| Department | Org unit (real starting list: Sales, Operations, PPC, Catalog, Finance, etc.) | Example seed data — admin-editable |
| Reporting hierarchy | Manager/report tree, separate from role assignment | Drives cascading data-scope visibility |
| Journey | An admin-configurable pipeline a lead/seller can move through | Example seed data: Overlapping, Private Label, SPN & BD |
| Status | A single, admin-defined field tracking where a lead sits within its Journey | **Not split into stage+status** — see ADR-0001. Carries `outcome_type` (open/closed_won/closed_lost) and `behavior_type` (default/call_later/follow_up/archived) |
| Service | An attachable add-on module a lead can carry within a Journey (e.g. PPC, FBA, Cataloging) — not a separate pipeline | |
| Seller / Lead | The canonical business record | One record per real-world seller; may hold membership in multiple Journeys |
| Field | An admin-defined data attribute (the field builder's unit) | Per-Journey requirement rules, edit mode, visibility, source |
| Process instance | One lead/seller's membership in one Journey, including its current Status | A lead may have multiple active process instances; one may be primary |
| Assignment | A typed user responsibility within a process instance at a point in time | Assignment types are configurable strings/lookups, not fixed enums. Multiple current assignments of different types may coexist |
| Activity | A logged event on a lead: comment, status change, reassignment, field edit | Append-only |
| Task | An actionable reminder, auto-created by certain status `behavior_type`s or manually added | |
| SLA | A time rule attached to a status (e.g. audit within 24 hours) | |

**Reminder:** every example value in this table (journey names, department names, etc.) is seed/example data per `docs/requirements/source-of-truth.md` — the *concepts* are fixed, the *instances* are not.

## Phase 0 terminology reconciliation

The canonical terms above have been checked against `docs/data-model/schema.md` and
`docs/workflows/journey-definitions.md`.

| Concept | Canonical usage across the baseline | Result |
|---|---|---|
| Seller / Lead | One top-level business record; the two words are UI/domain synonyms for that same record | Consistent |
| Journey membership | `process_instances` represents a Lead participating in a Journey; Journey and Status do not live directly on `leads` | Reconciled |
| Linked lead | `lead_links` relates rare, separate top-level Lead records representing the same real-world contact; it does not model ordinary multi-Journey membership | Reconciled |
| Status | Exactly one current Status per process instance, with no separate Stage axis | Consistent with ADR-0001 |
| Assignment | A row in `assignments`, scoped to a process instance and identified by a configurable assignment type | Reconciled |
| Role | One active, admin-configurable permission profile per User | Consistent |
| Scope | `SELF`, `TEAM`, `DEPARTMENT`, or `ORGANIZATION` | Standardized |
| Activity | Append-only Lead history with one of four action types and a separate source discriminator | Reconciled |

No unresolved terminology inconsistency remains among these three documents after
the Phase 0 corrections. Unresolved source-data meanings are tracked separately in
`docs/requirements/open-decisions.md`; they must not be promoted into canonical
product terminology until Wellsure confirms them.
