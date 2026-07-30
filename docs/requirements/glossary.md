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
| Assignment | Ownership of a lead by a specific user/role at a point in time | Multiple concurrent assignment fields exist in practice (Lead Owner, Sales Associate, Team Leader, Operations Associate) — matches real Cronberry usage |
| Activity | A logged event on a lead: comment, status change, reassignment, field edit | Append-only |
| Task | An actionable reminder, auto-created by certain status `behavior_type`s or manually added | |
| SLA | A time rule attached to a status (e.g. audit within 24 hours) | |

**Reminder:** every example value in this table (journey names, department names, etc.) is seed/example data per `docs/requirements/source-of-truth.md` — the *concepts* are fixed, the *instances* are not.
