# ADR-0011: Endpoint documentation drift, and the shape of the activity read

**Status:** Accepted

## Context

`docs/api/endpoints.md` and the implemented HTTP transport have diverged
substantially. An audit of `apps/api/src/http/routes/` against the document
found roughly twenty documented paths with no backing route, in three distinct
categories:

1. **Whole modules that were never built.** `GET /tasks`,
   `PATCH /tasks/:id/complete`, five `/reports/*` endpoints, attachments,
   invoices and payments, email and webhook integrations. These correspond to
   `docs/requirements/v1-scope.md` items whose implementation phases have not
   run. `packages/workflow-engine` is still a two-line placeholder.
2. **Lead endpoints absorbed by a different route.** `PATCH /leads/:id/status`
   does not exist; status changes ride on `PATCH /leads/:id` with `statusId` in
   the body. `POST /leads/:id/services`, the two `/leads/bulk/*` paths,
   `GET /leads/export` and `POST /leads/import` have no route.
3. **A phantom method.** `GET /journeys/:id/statuses` is documented, but the
   path is registered for `POST` only. It 404s in production. The web client
   already works around it by reading the nested `statuses[]` from
   `GET /journeys/:id`, with the reason recorded in a comment at
   `apps/web/src/lib/api-client.ts`.

`PLANS.md` requires that a conflict between two source documents be surfaced and
resolved with an ADR rather than edited away silently. `AGENTS.md` names
`docs/` the source of truth over example data, but says nothing about docs that
describe endpoints which do not exist — that is drift, not a conflict of
authority.

Separately, Phase 11 needed to read the lead activity log.
`GET /leads/:id/activity` sits in category 1: documented, never implemented, and
with no contract beyond its path.

## Decision

**The implemented transport is authoritative for what exists.** The document
describes both the built surface and the V1 target, so entries are annotated
rather than deleted — deleting them would lose the roadmap that
`docs/requirements/v1-scope.md` still commits to. Every documented path with no
backing route is marked as not implemented, following the precedent already set
for `/auth/refresh` in the Auth section.

**`GET /leads/:id/activity` is implemented to a contract defined here**, since
the document specified only a path:

- Gated on `leads:view`. No new permission-catalogue entry: the timeline is a
  projection of the record, so it carries the record's authorization rather
  than one of its own.
- Authorization runs the same per-process-instance loop as `GET /leads/:id`,
  now extracted as `resolveLeadAccess` and shared by both. Journey access,
  record scope and field visibility therefore behave identically on the record
  and its history.
- Rows whose `process_instance_id` names a journey the caller cannot see are
  excluded in the query rather than after the fetch, so pagination stays
  correct. Rows with a null `process_instance_id` are lead-level and returned
  to anyone who can see the lead.
- **`old_value` and `new_value` are redacted against the caller's visible field
  set.** `LeadService.editLead` stores the entire lead record on both sides of a
  change, so these payloads contain values that field-level visibility denies on
  the record itself. Redaction keys off the presence of a `fieldValues` object
  in the payload rather than the row's `action_type`, so a future writer that
  attaches field values to a different action is covered by default.
- Response is `{ page, pageSize, total, items }`, newest first, `pageSize`
  capped at 100 — matching the configuration read routes.

## Consequences

The document stops implying capability the API does not have, which was the
proximate cause of at least two defects in Phase 10 where client code was
written against documented routes that 404 in production.

The activity contract is now fixed, and the redaction rule is the part that must
not regress: it is the only thing standing between the timeline and a
field-visibility bypass. It is covered by a test asserting that neither a denied
field's id nor its values appear anywhere in the serialized response.

Marking rather than deleting keeps one document doing two jobs — describing what
exists and what is planned. If that proves confusing, the follow-up is to split
the roadmap into `docs/requirements/`, not to delete the entries.
