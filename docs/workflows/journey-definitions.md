# Journey / Status Definitions — Example Seed Data

**Read `docs/requirements/source-of-truth.md` first.** Everything in this document is real example data used to (a) prove the Journey/Status/Field builder works end-to-end and (b) seed the system on day one. None of it should be hardcoded into application logic. An admin must be able to delete every value in this document through the UI and the system keeps working.

---

## Journeys (seed data)

| Journey | Notes |
|---|---|
| Overlapping | Default journey on install |
| Private Label | |
| SPN & BD | |

Each runs conceptually Lead → Renewal. A lead can hold membership in more than one simultaneously; one is marked primary.

## Statuses (seed data, per real Cronberry usage — one flat list per Journey, see ADR-0001)

Example statuses seen in real data, with inferred `behavior_type` (flagged as an assumption when first proposed, not yet independently re-verified against every value):

| Status | outcome_type | behavior_type |
|---|---|---|
| Interested (default on lead creation) | open | default |
| Pitch In Progress | open | call_later |
| Registration Done | open | call_later |
| Ready For Ungatting / Ready For Audit | open | follow_up |
| Audit Done | open | follow_up |
| Transfer To FBA | open | call_later |
| Pending For Launch | open | follow_up |
| Launched | closed_won | default |
| Waiting For First Order | open | default |
| Working / Working or Stable | open | default |
| Issue | open | default |
| Not Interested | closed_lost | archived |
| Unable to Launch | closed_lost | archived |
| Blacklisted | closed_lost | archived |
| Drop | closed_lost | archived |

## Services (seed data — attachable, not separate pipelines)

PPC Management, Cataloging, Account Management, Brand Registry, FBA, Images Creation, Reviews Management, Reinstatement Appeal, A+ / Brand Store, Training.

## Departments (seed data, 20)

Sales, Operations, PPC, Catalog, Graphic Design, Video Editors, Photography, Finance, HR, Admin, Support, Compliance, Brand Registry, Trademark, Warehouse, Logistics, Customer Success, Business Development, Marketing, Management, Audit.

## Designations (seed data, 23)

Sales Executive, Senior Sales Executive, Sales TL, Sales Manager, Operations Executive, Senior Operations Executive, Operations TL, Operations Manager, Catalog Executive, PPC Executive, Graphic Designer, Photographer, Finance Executive, HR Executive, Director, Admin, Auditor, Trainer, Customer Success Manager, Business Development Executive, Account Management Sales Executive, Account Management Operations Executive, Ads Executive.

## Real assignment fields observed (per actual Cronberry export — becomes the Assignment model)

Lead Owner, Prev Lead Owner (history), Sales Associate, Team Leader, Operations Associate, plus secondary collaborator fields for Ops/Sales/Account Management. A reassignment counter (`lead_reassign`) is tracked historically — worth carrying forward as a computed count on `activity_logs`, not a separate stored counter, to avoid drift.

## Status change side effects

1. Update the lead's current status.
2. Look up the new status's `behavior_type`:
   - `call_later` → create a task (due date, assigned to current owner)
   - `follow_up` → create a task; if `auto_reassign_to_role_id` is set, reassign ownership
   - `archived` → excluded from active list/kanban views by default, still queryable
3. Write an `activity_logs` entry (`status_change`, old/new values).

Deleting a status with active leads in it is blocked until they're bulk-reassigned to a replacement status — no silent data loss.
