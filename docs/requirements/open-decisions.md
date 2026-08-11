# Open Decisions Register

This register contains only unresolved decisions. Accepted ADRs and the Phase 0
schema corrections are not reopened here. Unless stated otherwise, data-mapping
questions block final import mapping/implementation but do not block completing
the Phase 0 documentation baseline or foundational Phase 1 work.

## Product/architecture decision

### OD-001 — Authentication provider

- **Status:** Resolved — custom, self-hosted session authentication for V1.
- **Owner:** Wellsure product/security/architecture.
- **Decision:** Falcon V1 uses API-owned email/password authentication with
  argon2id password hashes and server-side, tenant-scoped, revocable sessions
  referenced by secure httpOnly sameSite cookies. Registration remains out of
  scope; admins create users.
- **Source:** ADR-0007 records the accepted V1 auth decision. ADR-0005 is
  superseded for V1 implementation planning.
- **Implementation impact:** Auth is no longer blocking Phase 3. Do not build
  Cognito, Keycloak, OAuth, social login, SSO, MFA, magic links, or JWT-based
  auth paths for V1.

### OD-020 — apps/api HTTP server transport

- **Status:** Resolved in Phase 6 — Fastify binds the implemented route
  functions, and the web development server proxies `/api` to that real
  transport. MSW is retained only by the frontend test setup.
- **Owner:** Wellsure engineering/architecture.
- **Problem:** The route functions in `apps/api/src/routes/` (auth,
  configuration, leads) exist and are tested in isolation — unit tests call
  them directly, and a Testcontainers-backed integration suite exercises the
  Prisma repository against real Postgres — but nothing binds any of them to
  an actual HTTP method+path over a network port. There is no Express/
  Fastify/Hono/etc. dependency anywhere in `apps/api/package.json` and no
  `server.ts`/`app.ts`. `docs/api/endpoints.md` documents a target contract,
  not a running API.
- **Decision:** ADR-0008 selected Fastify with first-party cookie, CORS,
  rate-limit, and OpenAPI plugins. The Phase 6 implementation keeps the route
  functions transport-independent and places process startup in
  `apps/api/src/main.ts`.
- **Implementation impact:** Closed. `/auth/me` is bound for frontend session
  restoration; endpoints that still have no backing route function remain
  follow-up application work rather than transport bindings.
- **Source:** identified while building the real `apps/web` frontend against
  the documented/verified route contract.

## Migration/data-team decisions

The following items require Wellsure data-team review before the import mapping
is finalized. Preserve source values only in access-controlled staging until a
mapping is approved; do not guess destinations.

| ID | Source column(s) | Decision required | Provisional recommendation / impact |
|---|---|---|---|
| OD-002 | `pcid`, `seller_merchant_token` | Identify the authoritative marketplace seller ID or confirm distinct meanings. | Blocks ADR-0004 priority-2 implementation. |
| OD-003 | `seller_status`, `lead_status` | Confirm duplicate concepts versus a distinct post-conversion account-health attribute. | Keep `lead_status` as process Status; do not map `seller_status` until confirmed. |
| OD-004 | `source_name`, `lead_source` | Define whether values overlap and the precedence when both are populated. | Candidate canonical configurable source Field after confirmation. |
| OD-005 | Five `quotation_*` columns | Confirm whether informational retention is required despite no V1 quotation workflow. | Recommend configurable Fields only, not a quotation module; scope approval required. |
| OD-006 | `issue` | Determine whether it is independent data or duplicates a source Status whose seed label is “Issue.” | Never infer equivalence from the label. |
| OD-007 | `is_shared` | Define sharing semantics and whether it maps to an assignment concept. | No assignment/grant behavior until confirmed. |
| OD-008 | `amount` | Identify currency, business event, and relationship to invoice/payment data. | Too generic for safe finance mapping. |
| OD-009 | `file_name` | Identify its related file/link and whether it is attachment metadata. | Keep in staged evidence; do not create an Attachment without a resolvable object/reference. |
| OD-010 | `form_steps` | Define meaning and V1 relevance. | No destination yet. |
| OD-011 | `cart_add_date` | Define meaning and V1 relevance. | No destination yet. |
| OD-012 | `domain` | Define meaning and V1 relevance. | No destination yet. |
| OD-013 | `order_date`, `order_id`, `order_status` | Confirm whether an order concept is required in V1 and how the three fields relate. | No order module exists in confirmed V1 scope. |
| OD-014 | `retained_by` | Determine whether this is a user assignment, history, or another attribute. | Candidate configurable assignment type only after confirmation. |
| OD-015 | `updated`, `lead_update_date` | Confirm whether `updated` duplicates the source update timestamp and establish precedence. | Use `lead_update_date` only after confirmation; retain `updated` in staging meanwhile. |
| OD-016 | Status `behavior_type` seed assignments | Verify every proposed `default`, `call_later`, `follow_up`, and `archived` value. | Blocks approval of the seed status mapping, not the configurable Status engine. |
| OD-017 | Export header completeness | **Closed.** All 120 columns have a disposition. | Resolved by a programmatic full-header-to-ledger cross-check, not source-row sampling. The five quotation headers and final `message` header are now explicit in the migration ledger. |

## Non-blocking validation follow-up

### OD-018 — Full-export data profiling

- **Status:** Open, non-blocking for Phase 0; required before production import.
- **Need:** Profile a representative/full export rather than the existing small
  sample to detect additional malformed values, conflicting duplicate columns,
  unexpected status values, identity collisions, and encoding/date issues.
- **Exit evidence:** documented counts and examples with personal data redacted,
  plus updated migration validation rules and synthetic regression fixtures.

### OD-019 — `message` source-column meaning

- **Status:** Open; blocks final mapping of this column, not Phase 1 foundation.
- **Need:** Confirm whether `message` is notification/SMS content or another
  generic Cronberry value and whether it has any V1 relevance.
- **Until resolved:** Retain only in access-controlled staging. Do not map it to
  notifications, activities, tasks, or communications based on its name alone.

### OD-020 — `fields.field_type` accepted on create but unusable at write time

- **Status:** Open; a real defect, found during Phase 13b planning. Not blocking
  the filter engine, which simply reports such a Field as not filterable.
- **Need:** `ConfigurationService.createField` stores `field_type` as any
  non-blank string, while `validateValue` in `apps/api/src/leads/validation.ts`
  accepts only `text`, `textarea`, `email`, `phone`, `date`, `select`, `number`,
  `boolean` and `json`. A Field created with any other type — `currency` is the
  obvious one an admin would reach for — can never hold a value: every write to
  it fails validation. Nothing warns the admin at creation time.
- **Proposed fix:** validate `field_type` against the supported list in
  `configuration/validation.ts`, as its own change with its own audit-visible
  behaviour change. Deliberately kept out of Phase 13b so the filter engine's
  diff stays about filtering.
- **Open question for Wellsure:** whether `currency` should become a real
  supported type (formatting, precision, and a filter kind of its own) or
  whether currency amounts stay `number`. Phase 13b treats them as `number`.

## Decision process

1. Record Wellsure's answer and evidence for the relevant ID.
2. If the answer changes architecture or an accepted decision, add/supersede an
   ADR; do not silently edit away the prior decision.
3. Update `docs/migration/cronberry-mapping.md` and this register together.
4. Add a redacted migration fixture/test for each resolved source-data ambiguity.
5. Do not include secrets or real personal data in the decision record.
