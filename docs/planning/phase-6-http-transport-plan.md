# Phase 6 Plan — HTTP Transport for apps/api

## Goal

Bind the already-implemented, already-tested route functions in
`apps/api/src/routes/{auth,configuration,leads}.ts` to a real Fastify HTTP
server — composition root, fail-fast environment configuration, session-cookie
middleware, CORS, auth-endpoint rate limiting, correlated structured logging,
a route-result-to-HTTP-response mapper, and a health endpoint — so `apps/web`
can eventually call a real API instead of the MSW mock layer, resolving
OD-020's transport gap without inventing endpoints that don't exist yet.

## Docs read

- `AGENTS.md`, `PLANS.md`
- `docs/requirements/source-of-truth.md`
- `docs/requirements/glossary.md`
- `docs/requirements/v1-scope.md`
- `docs/requirements/open-decisions.md` (OD-020)
- `docs/api/endpoints.md`
- `docs/api/auth.md`
- `docs/permissions/access-model.md`
- `docs/operations/runbook.md`
- `docs/testing/quality-gates.md`
- `docs/architecture/decisions/0006-team-scope-from-hierarchy.md`
- `docs/architecture/decisions/0007-custom-session-auth.md`
- `docs/architecture/decisions/0008-http-framework.md` (companion ADR for this plan)
- `docs/planning/phase-1-backlog.md` (P1-03)
- `docs/planning/phase-5-lead-seller-core-plan.md`

Source read: `apps/api/src/index.ts`, `apps/api/package.json`,
`apps/api/src/routes/{auth,configuration,leads}.ts`,
`apps/api/src/auth/{middleware,cookies,session,config}.ts`,
`apps/api/src/leads/validation.ts`,
`apps/api/src/__tests__/leads.integration.test.ts`,
`apps/api/src/__tests__/fixtures/synthetic-auth.ts`,
`packages/database/{package.json,src/index.ts,prisma/schema.prisma}`,
`packages/permission-engine/src/decision.ts`,
`packages/observability/src/index.ts`,
`apps/web/src/lib/{api-client.ts,api-error.ts}`, `apps/web/src/types/domain.ts`,
`apps/web/src/mocks/{handlers.ts,session.ts}`, `apps/web/src/main.tsx`,
`apps/web/vite.config.ts`, root `package.json`, `.env.example`,
`docker-compose.yml`, `eslint.config.ts`.

## Current state

- **No HTTP framework anywhere.** Repo-wide search finds no
  fastify/express/hono/`node:http` usage. `apps/api/package.json`'s only
  dependencies are `@falcon/permission-engine` and `argon2`; there is no
  `server.ts`/`app.ts`/`main.ts`.
- **`apps/api/src/index.ts` is a pure library barrel with no side effects.**
  It exports auth primitives (`defaultAuthConfig`,
  `hashPassword`/`normalizeEmail`/`verifyPassword`,
  `issueSession`/`revokeSession`/`validateSession`, `login`,
  `completePasswordReset`/`requestPasswordReset`, `authenticateCookie`,
  `PrismaAuthRepository`), `PrismaPermissionRepository`, the leads route
  functions (`createLead`/`editLead`/`getLeadById`/`getSeller360`/
  `listSellers`), all of `routes/configuration.ts`'s exports, and the
  leads/configuration service/validation/error modules. Nothing reads
  `process.env`, opens a socket, or otherwise performs I/O at import time.
- **`routes/auth.ts`'s HTTP-shaped wrappers are not re-exported from
  `index.ts`.** `loginRoute`, `logoutRoute`, `requestPasswordResetRoute`, and
  `completePasswordResetRoute` already return `{ status, headers?, body }`
  exactly like the leads/configuration wrappers do, but — unlike those —
  they aren't part of `index.ts`'s public export surface today. This is an
  inconsistency in the export barrel, not a functional gap.
- **Every route function already returns a plain, framework-agnostic
  result.** `LeadRouteResult` and `ConfigurationRouteResult` are both `{
  status: 200|201; body } | { status: 400|403|404|409; body: { error:
  string; details?: Record<string, unknown> } }`; `routes/auth.ts`'s ad hoc
  return types match the same flat shape. Error bodies are uniformly `{
  error: string, details?: ... }` — a flat code string, **not** the `{
  error: { code, message, details? } }` shape `docs/api/endpoints.md`'s
  Standards section documents. This exact discrepancy is already flagged in
  a code comment at `apps/web/src/types/domain.ts:162` ("Flat error-code
  body — matches the real code, not endpoints.md's stale {code,message}
  shape."). See Risks / open questions.
- **`authenticateCookie` already does the session-middleware work.**
  `apps/api/src/auth/middleware.ts`'s `authenticateCookie({ repository,
  config, cookieHeader })` takes a raw `Cookie` header string and returns
  `AuthenticatedContext { user: UserSnapshot; session: SessionRecord } |
  null` — `UserSnapshot` is exactly the shape `resolveAuthorization` (the
  permission engine) consumes. No new session/user-snapshot construction
  logic is needed; only a thin Fastify `preHandler` around this function.
- **No production Prisma wiring exists for HTTP purposes.**
  `PrismaAuthRepository`, `PrismaPermissionRepository`, and
  `PrismaLeadRepository` (`apps/api/src/leads/prisma-lead-repository.ts`,
  already present) each accept a narrow *structural* client interface
  (e.g. `PrismaAuthClient`), not the real generated `@prisma/client` type —
  so any object satisfying that shape works, including the real client.
  `apps/api/package.json` has no dependency on `@falcon/database` or
  `@prisma/client` today; only test fixtures build a Postgres-compatible
  client (via the `postgres` package + Testcontainers). `@falcon/database`
  generates its Prisma Client to `packages/database/generated` (per its
  `schema.prisma` generator block) but `packages/database/src/index.ts` is
  still a placeholder (`export const databaseSchemaPath = ...`) with no
  client-factory export.
- **No environment-variable handling exists in `apps/api/src` runtime code
  at all.** The only env var referenced anywhere under `apps/api/src` is the
  test-only `FALCON_POSTGRES_URL` (`apps/api/src/__tests__/fixtures/synthetic-auth.ts`).
  The root `.env.example` uses plain, unprefixed names
  (`DATABASE_URL`, `TEST_DATABASE_URL`, `POSTGRES_*`, `REDIS_URL`, `S3_*`).
  `apps/api` has no schema-validation dependency (`apps/web` has `zod
  4.4.3`; `apps/api` does not).
- **`apps/web` already has a working consumer of the target contract.**
  `apps/web/src/lib/api-client.ts` calls `fetch('/api/v1' + path, {
  credentials: 'include', ... })`. `apps/web/vite.config.ts` has no
  `server.proxy` entry today — in dev this currently only "works" because
  MSW's service worker intercepts the request at the network layer
  regardless of same-origin/proxy configuration, not because a proxy
  exists. MSW starts unconditionally in dev via `main.tsx`'s
  `import.meta.env.DEV` gate (`onUnhandledRequest: 'bypass'`).
- **`packages/observability/src/index.ts` is an empty placeholder** — no
  existing logging conventions to reuse; this phase introduces the first
  ones.
- **Route coverage against `docs/api/endpoints.md` is partial.** Enumerated
  precisely in Proposed approach, since the exact existing/missing split
  drives what this plan is allowed to bind versus must defer.
- Node engine is pinned `>=24 <25` (root `package.json`); pnpm `10.28.1`;
  TypeScript `6.0.3`.

## Proposed approach

### 1. Composition root, relative to `index.ts`'s pure exports

`apps/api/src/index.ts` stays exactly what it is today — a side-effect-free
export barrel — plus one non-behavioral addition: re-export `loginRoute`,
`logoutRoute`, `requestPasswordResetRoute`, and `completePasswordResetRoute`
from `routes/auth.ts`, for consistency with how leads/configuration route
wrappers are already exported. The HTTP transport is new, separate modules
that consume `index.ts`'s exports (or import route files directly, since
they're in the same package) rather than folding transport concerns into it:

- `apps/api/src/http/build-server.ts` — a pure `buildServer(deps):
  FastifyInstance` factory that takes already-constructed repositories/config
  as input and never calls `.listen()`. This is what contract tests import.
- `apps/api/src/http/routes/{auth,configuration,leads,health}.ts` — one file
  per module, registering Fastify routes that call the existing route
  functions and translate results (see §4).
- `apps/api/src/http/plugins/{cookies,cors,rate-limit,logging,openapi}.ts` —
  one file per cross-cutting concern (§3, §5, §6, §7, and OpenAPI wiring).
- `apps/api/src/env.ts` — fail-fast environment parsing (§2).
- `apps/api/src/main.ts` — the actual process entry point: reads env,
  constructs the Prisma client and repositories, calls `buildServer(...)`,
  calls `.listen()`, and wires graceful shutdown (§10). This is the only
  file in `apps/api` that performs process-level side effects (`process.env`
  reads, `process.on`, `.listen()`).

`apps/api/package.json`'s `exports` field stays `./dist/index.js` (the
importable library surface, used by tests and any future consumer);
`main.ts` is invoked directly (e.g. `node dist/main.js`) to actually run the
server, so importing `@falcon/api` never triggers a `.listen()`.

### 2. Environment configuration and fail-fast validation (P1-03)

New `apps/api/src/env.ts` reads `process.env` once at startup and throws
before `buildServer`/`.listen()` are reached if a required variable is
missing or fails a type/format check, per `phase-1-backlog.md`'s P1-03
acceptance criteria ("Startup fails clearly for missing/invalid required
configuration"). Proposed required variables, using the `FALCON_` prefix
precedent from the existing test-only `FALCON_POSTGRES_URL` (see Risks for
the naming question this raises):

- `FALCON_DATABASE_URL`
- `FALCON_HTTP_PORT`
- `FALCON_CORS_ORIGIN` (one or more allowed origins for `@fastify/cors`)
- `FALCON_SESSION_COOKIE_SECURE`, exposed so `AuthConfig.secureCookies`/
  `sameSite` can differ across dev/staging/production (§Risks — exact
  per-environment values are not decided here)
- `FALCON_LOG_LEVEL`

Given `apps/api` has zero env-parsing dependencies today, the default
proposal is a small hand-written `parseEnv()` (explicit required-key list,
type coercion, one thrown `Error` that lists every problem found, not just
the first) rather than adding `zod` to `apps/api` — introducing `zod` for
symmetry with `apps/web` is a reasonable alternative but is a new production
dependency requiring justification per `AGENTS.md`, so it's left as an
implementation-time choice, not decided here. `apps/web`'s env handling is
untouched; server-only values must never be importable from `apps/web`,
which is naturally enforced by `env.ts` living entirely under `apps/api/src`.

### 3. Session cookie middleware

A Fastify `preHandler`, registered on an authenticated-routes plugin scope
(not globally — login/password-reset endpoints must stay reachable
unauthenticated), that:

1. Reads the raw `Cookie` header from `request.headers.cookie`.
2. Calls the existing `authenticateCookie({ repository: sessionRepository,
   config: authConfig, cookieHeader })` unchanged — no new session/user-
   snapshot logic is written here.
3. On `null`, replies `401` with the error shape decided per §4/Risks,
   without invoking the wrapped route handler.
4. On success, attaches the returned `AuthenticatedContext` to a typed
   `request.auth` decorator (`fastify.decorateRequest`), so route handlers
   pass `auth: request.auth` straight into the existing route functions
   (`createLead`, `editLead`, `listSellers`, etc.), which already expect
   exactly that shape.

`@fastify/cookie` is registered so `request.cookies`/`reply.cookie()` exist
for any future non-session cookie, but the preHandler itself reads the raw
header directly and defers to `parseCookie`/`authenticateCookie`, per
ADR-0008's note that `apps/api/src/auth/cookies.ts` remains authoritative
for the session cookie's own semantics.

### 4. Mapping route results to HTTP status codes and the error shape

Every existing route function already returns a discriminated `{ status,
headers?, body }` object. The Fastify handler for each bound endpoint is
therefore mechanical: apply any `headers` from the result via
`reply.header(...)`, then `reply.status(result.status).send(result.body)` —
no per-endpoint HTTP logic beyond this generic adapter is needed.

**This step cannot be finalized exactly as `docs/api/endpoints.md`
specifies** (`{ error: { code, message, details? } }`) without resolving the
flat-vs-nested error-shape conflict described in Current state and in
ADR-0008's Consequences — see Risks / open questions. This plan does not
pick a side; the generic mapper is written so that whichever shape is
approved is a one-place change (inside this mapper), not a per-route change.

### 5. CORS

`@fastify/cors` registered with `credentials: true` and an explicit origin
allow-list sourced from `FALCON_CORS_ORIGIN` (never `*`, which the Fetch
spec forbids combining with credentialed requests). The exact origin
value(s) per environment depend on the dev-proxy question in Risks.

### 6. Rate limiting

`@fastify/rate-limit` registered only on the auth-endpoint plugin scope
(`/api/v1/auth/*`), keyed by normalized email + IP consistent with the
existing lockout keying in `apps/api/src/auth/login.ts`, as an HTTP-layer
defense-in-depth complement to — not a replacement for — the already-
implemented application-level lockout (`AuthConfig.lockoutMaxAttempts` /
`lockoutWindowMs` / `lockoutDurationMs`).

### 7. Request-scoped structured logging with correlation IDs

Fastify's built-in Pino logger, configured with:

- `genReqId` reading an inbound `x-request-id`/`x-correlation-id` header
  when present, otherwise generating one, and echoing it back on the
  response so `apps/web` and future load-test tooling can correlate.
- An explicit `redact` array covering the `cookie`/`set-cookie` and
  `authorization` headers, and any request-body path that could carry a
  credential or personal data (`req.body.password`, `req.body.token`,
  `req.body.newPassword`, dynamic `fieldValues.*`) — enforced by
  configuration, not by convention, so **no credential, session token, or
  personal data is ever logged**.
- No response bodies logged by default (list/detail responses carry Lead
  personal data).

### 8. Health endpoint

`GET /health` — unauthenticated, and outside `/api/v1` since it's an infra
liveness concern, not a business endpoint — registered directly in
`build-server.ts`, not backed by any route function (there is nothing to
bind; it's new). Returns `200 { status: 'ok' }` when the process can respond
at all. A readiness variant that also checks the Prisma connection is a
reasonable follow-up but isn't required to satisfy this plan's health-
endpoint requirement, so it's noted as optional rather than assumed.

### 9. Prisma client lifecycle

`apps/api/package.json` gains a dependency on `@falcon/database` (already an
existing workspace package) so `apps/api/src/main.ts` can obtain a real
`PrismaClient` and construct one instance at startup, passed into
`PrismaAuthRepository`/`PrismaPermissionRepository`/`PrismaLeadRepository`
(each already accepts any object satisfying its narrow structural client
interface, so the real client satisfies them without modification). Since
`packages/database/src/index.ts` is currently just a placeholder with no
client-factory export, this plan proposes adding a minimal
`createPrismaClient()` there — the natural home per `AGENTS.md`'s package
layout — rather than instantiating `PrismaClient` directly inside
`apps/api`, so future consumers (e.g. `apps/worker`) share one construction
path. Lifecycle: one client per process; `$connect()` is not called
explicitly (Prisma connects lazily on first query); `main.ts`'s graceful-
shutdown handler calls `client.$disconnect()`.

### 10. Graceful shutdown

`main.ts` registers `SIGTERM`/`SIGINT` handlers that: stop accepting new
connections via `fastify.close()` (which drains in-flight requests before
resolving), then call `prismaClient.$disconnect()`, then exit. This matters
directly for ECS Fargate task replacement (`docs/operations/runbook.md`),
where a running task receives `SIGTERM` before forced termination.

### 11. Binding existing routes — and explicitly not inventing missing ones

**Auth** (`apps/api/src/routes/auth.ts`):

| Function | Method + path | Notes |
|---|---|---|
| `loginRoute` | `POST /api/v1/auth/login` | Matches `docs/api/auth.md`. |
| `logoutRoute` | `POST /api/v1/auth/logout` | Requires the session-cookie preHandler (needs `sessionId`/`organizationId`/`actorUserId` from `request.auth`). |
| `requestPasswordResetRoute` | `POST /api/v1/auth/password-reset/request` | Unauthenticated. |
| `completePasswordResetRoute` | `POST /api/v1/auth/password-reset/complete` | Unauthenticated. |

`GET /auth/me` and `POST /auth/refresh` — both listed in
`docs/api/endpoints.md`'s Auth section — have **no backing route function**:
no `meRoute`, no session-refresh logic anywhere in `apps/api/src/auth/`.
Not implemented here; see Risks (this directly blocks retiring MSW for the
frontend's session-restore flow, since `apps/web/src/lib/api-client.ts`'s
`authApi.me()` already calls it against the mock).

**Configuration** (`apps/api/src/routes/configuration.ts`) — all ten
exported functions are mutations; **no read/list route function exists in
this file at all**:

| Function | Method + path | Notes |
|---|---|---|
| `createJourney` | `POST /api/v1/journeys` | |
| `createStatus` | `POST /api/v1/journeys/:journeyId/statuses` | |
| `deactivateStatus` | `DELETE /api/v1/statuses/:statusId` | Body carries optional `replacementStatusId`. |
| `createService` | `POST /api/v1/services` | |
| `deactivateService` | `DELETE /api/v1/services/:serviceId` | |
| `createField` | `POST /api/v1/fields` | |
| `deactivateField` | `DELETE /api/v1/fields/:fieldId` | |
| `mapJourneyService` / `unmapJourneyService` | both under `PUT /api/v1/journeys/:journeyId/services` | See note below — not a clean 1:1 with `endpoints.md`. |
| `upsertFieldVisibility` | proposed `PUT /api/v1/roles/:roleId/field-visibility/:fieldId` | No documented path exists for this — see note below. |

`GET /journeys`, `PATCH /journeys/:id`, `DELETE /journeys/:id`, `GET
/journeys/:id/statuses`, `PATCH /statuses/:id`, `GET /services`, `GET
/fields`, `PATCH /fields/:id`, `GET /journeys/:id/fields`, and `PUT
/journeys/:id/fields/:fieldId` (the requirement/required-from-status/
visibility-per-Journey endpoint, which is `field_journey_settings`, not
`field_visibility`) are all documented but have **no backing route
function** — not implemented here, later phase.

`mapJourneyService`/`unmapJourneyService` both being bound under one `PUT
/journeys/:id/services` line is a simplification `endpoints.md` doesn't
spell out (`PUT` there reads as "replace the whole service set"; the actual
functions are two separate create/delete-mapping calls). This plan proposes
keeping them as two calls dispatched under one path (e.g. by an `action`
field), but this is an implementation-time detail flagged for sign-off, not
assumed silently.

`upsertFieldVisibility` sets a `(field, role)` → `VIEW`/`EDIT` row in
`field_visibility` — the access-model's field-level visibility mechanism —
but `endpoints.md` has no endpoint for it at all; its nearest neighbor, `PUT
/journeys/:id/fields/:fieldId`, is documented as being about a Journey's
`requirement`/`required_from_status`/visibility settings
(`field_journey_settings`, a different table with no implemented mutation
function). This plan proposes `PUT /roles/:roleId/field-visibility/:fieldId`,
consistent with the existing `/roles/:id/permissions` and
`/roles/:id/journey-access` naming pattern, and flags that
`docs/api/endpoints.md` should be updated with this path once approved —
not silently treated as already documented.

**Leads** (`apps/api/src/routes/leads.ts`):

| Function | Method + path | Notes |
|---|---|---|
| `listSellers` | `GET /api/v1/leads` | `journeyId` genuinely optional — see Risks (Seller List all-Journeys). |
| `createLead` | `POST /api/v1/leads` | |
| `getSeller360` | `GET /api/v1/leads/:id` | Matches the documented Phase 5 contract (journey/status objects, assignments). |
| `editLead` | `PATCH /api/v1/leads/:id` | Already handles core-field edits **and** status transitions in one call. |

`getLeadById` (the `LeadReadRepository`-backed function, returning the
simpler `LeadDetailRecord` shape with no assignments/journey names) also
exists and would collide with `getSeller360` on the same `GET
/api/v1/leads/:id` path. `docs/planning/phase-5-lead-seller-core-plan.md`
itself calls it "the legacy/simple lead detail path if it remains exported"
— its status was already ambiguous before this task. This plan binds `GET
/api/v1/leads/:id` to `getSeller360` (it matches the documented contract)
and leaves `getLeadById` unbound; deciding whether to delete it is a
follow-up `apps/api/src` cleanup, out of scope here.

`endpoints.md`'s top-level Leads section lists `PATCH /leads/:id/status` and
`PATCH /leads/:id/reassign` as endpoints separate from `PATCH /leads/:id`,
but its own, more detailed Phase 5 section already documents `PATCH
/leads/:id` as the mechanism for status changes too, and `editLead` has no
assignment/reassignment parameter at all. This plan binds only `PATCH
/leads/:id` (to `editLead`) and does **not** invent `PATCH /leads/:id/status`
or `PATCH /leads/:id/reassign` — neither has an implementation.

`POST /leads/:id/services`, `GET /leads/:id/activity`, `POST
/leads/:id/comments`, `POST /leads/bulk/reassign`, `POST
/leads/bulk/status`, `GET /leads/export`, `POST /leads/import`, and every
endpoint under Users/Roles/Departments, Tasks, Attachments, Finance,
Reports, and Integrations have no route file at all — not implemented here,
later phases, matching Out of scope below.

## Files to touch

- `apps/api/package.json` — add `fastify`, `@fastify/cookie`,
  `@fastify/cors`, `@fastify/rate-limit`, `@fastify/swagger`,
  `@fastify/swagger-ui`, and `@falcon/database` (workspace) as dependencies.
- `apps/api/src/index.ts` — add the missing `routes/auth.ts` wrapper exports
  (§1); no other change.
- `apps/api/src/env.ts` (new)
- `apps/api/src/main.ts` (new)
- `apps/api/src/http/build-server.ts` (new)
- `apps/api/src/http/errors.ts` (new) — the route-result → HTTP mapper (§4)
- `apps/api/src/http/plugins/cookies.ts` (new)
- `apps/api/src/http/plugins/cors.ts` (new)
- `apps/api/src/http/plugins/rate-limit.ts` (new)
- `apps/api/src/http/plugins/logging.ts` (new)
- `apps/api/src/http/plugins/openapi.ts` (new)
- `apps/api/src/http/routes/auth.ts` (new)
- `apps/api/src/http/routes/configuration.ts` (new)
- `apps/api/src/http/routes/leads.ts` (new)
- `apps/api/src/http/routes/health.ts` (new)
- `apps/api/src/__tests__/http/*.contract.test.ts` (new)
- `packages/database/src/index.ts` — add `createPrismaClient()` export
- `.env.example` (root) — add `FALCON_HTTP_PORT`, `FALCON_CORS_ORIGIN`,
  `FALCON_LOG_LEVEL`, `FALCON_SESSION_COOKIE_SECURE`, and (pending the
  naming question in Risks) either rename or add `FALCON_DATABASE_URL`
- `apps/web/vite.config.ts` — only if a Vite dev proxy is approved (Risks);
  no other `apps/web` file needs to change for the API itself to become
  reachable, since `api-client.ts` already calls a relative `/api/v1` path
  with `credentials: 'include'`
- `docs/api/endpoints.md` — updated after implementation/approval to
  reflect: the actually-bound paths above, `upsertFieldVisibility`'s path,
  the `PUT /journeys/:id/services` map/unmap shape, and the error-envelope
  shape once decided

## Out of scope

- No workflow side effects beyond what `createLead`/`editLead` already
  implement.
- No import or migration execution.
- No finance, dashboards, attachments, email, bulk operations, or export
  endpoints — none have route functions to bind, and none are invented here.
- No production deployment (Terraform apply, ECS task definitions,
  ALB/WAF config).
- No hardcoded Journey, Status, Field, Role, Service, Department, or
  assignment-type names anywhere in the transport code — every binding
  above operates on IDs supplied by the caller/config, never seed names.
- No endpoints beyond the ones enumerated in §11 as already implemented —
  anything `endpoints.md` documents without a backing route function is
  explicitly deferred to a later phase, not built here.
- No change to route/service/repository/permission-engine business logic —
  this is a transport layer around what already exists and already passes
  its own tests.

## Risks / open questions

1. **Cookie `SameSite`/`Secure` attributes across dev, staging, and
   production.** `AuthConfig.sameSite` defaults to `'lax'` and
   `secureCookies` defaults to `true`. `Secure` cookies are rejected by
   browsers over plain `http://localhost`, so local dev needs either
   `secureCookies: false` (an env override) or an HTTPS-capable local setup.
   Staging/production (real domains, real TLS per the runbook) can use
   `Secure: true` with `SameSite=Lax` **only if** the web and API origins
   end up same-site (see #2) — otherwise `SameSite=Lax` silently drops the
   cookie on cross-site requests, and login appears to succeed (200
   response) while the session cookie never gets sent back. Must be pinned
   down per environment before implementation, not left to `AuthConfig`'s
   defaults.

2. **Vite dev proxy vs. direct cross-origin calls, and what it implies for
   the cookie policy.** `apps/web/vite.config.ts` has no `server.proxy`
   entry today. Two real options:
   - **Vite dev proxy** (`server.proxy['/api'] = { target: 'http://localhost:<port>' }`):
     the browser sees same-origin requests, so `SameSite=Lax` (even
     `Strict`) works with no cross-site cookie issue. Lower risk, and the
     default recommendation.
   - **Direct cross-origin calls** (web on `:5173`, API on its own port, no
     proxy): requires `SameSite=None; Secure`, which in turn requires HTTPS
     even in local dev, plus `@fastify/cors` echoing the exact request
     origin (never `*`) with `credentials: true`.
   Which one Falcon adopts changes both the CORS config (§5) and the cookie
   config (#1) — needs an explicit answer before implementation.

3. **Whether MSW remains for `apps/web` unit tests after the real API
   exists.** `apps/web/src/mocks/` is currently a dev-only layer gated by
   `import.meta.env.DEV` in `main.tsx`. Once a real API exists, the dev-time
   MSW bootstrap should very likely be removed or feature-flagged off so
   local dev talks to the real API by default — but MSW (or an equivalent)
   may still be valuable for `apps/web`'s own component/unit tests that
   shouldn't require a running API + Postgres. This plan does not decide
   "keep MSW for tests only" versus "remove MSW entirely" — that's a
   product/DX call for whoever approves the frontend cutover.

4. **The Seller List all-Journeys question — a documentation conflict, not
   an open decision, and this plan is flagging that conflict rather than
   silently resolving it either way.** This task's brief described this
   as "the still-unapproved Seller List all-Journeys question ... since the
   HTTP contract cannot be finalised while it is open." Reading the actual
   sources does not support that framing:
   - `docs/api/endpoints.md` (Phase 5 section) already states: "When
     `journeyId` is omitted, Seller List returns **the approved all-Journeys
     aggregate view** across Journeys the requester is allowed to access."
   - `docs/planning/phase-5-lead-seller-core-plan.md` contains **two**
     sections on this. The first (original plan) lists it under Risks /
     open questions as "Approval required." A second, later "Phase 5
     Completion" section — added in a later commit (`docs: update phase 5
     completion plan`) — supersedes that with "**Approved product decision:
     Seller List supports an all-Journeys view when `journeyId` is
     omitted**," citing a reviewed Seller List UI prototype.
   - The code already implements it: `packages/permission-engine/src/decision.ts`
     explicitly branches on `journeyId === undefined` to authorize across
     all role-accessible Journeys, and `listSellers` in
     `apps/api/src/routes/leads.ts` only includes `journeyId` in the
     authorization request when it's defined, with no earlier validation
     error for its absence — consistent with a later commit (`feat: wire
     lead seller prisma repository`).

   By every source this plan found, the all-Journeys behavior is already
   approved and already implemented; nothing in the docs or code marks it as
   open. §11 binds `GET /api/v1/leads` with `journeyId` genuinely optional,
   consistent with that. **If there is a reason to treat it as unapproved
   that isn't reflected in the docs** (e.g. an approval reversal that hasn't
   been written back yet), that needs to be stated explicitly and the docs
   corrected — this plan does not assume either framing beyond what's
   actually written down, per the source-of-truth precedence rule.

5. **The `{ error: string }` vs. `{ error: { code, message, details? } }`
   conflict, and what it means for §4/§9 (error mapping + OpenAPI).**
   Covered in full in ADR-0008's Consequences. The HTTP-error-mapping
   adapter (§4) and the `@fastify/swagger`-generated error schema cannot be
   finalized until this is decided: either (a) `docs/api/endpoints.md` is
   corrected to document the flat shape that `apps/api/src/routes/*.ts`,
   `apps/web/src/lib/api-client.ts`, and the MSW handlers already agree on,
   or (b) the transport layer synthesizes the nested shape at the HTTP
   boundary only (a server-side code→message lookup, distinct from
   `apps/web`'s existing client-side `FRIENDLY_MESSAGES` map) and
   `apps/web`'s `ApiError`/`ApiErrorBody` are updated to match. Recommend
   (a), since three independent, already-tested layers agree with each
   other and disagree with the doc — but this is flagged for approval, not
   decided here.

6. **`GET /auth/me` and `POST /auth/refresh` have no backing implementation,
   and `apps/web` already depends on `/auth/me`.**
   `apps/web/src/lib/api-client.ts`'s `authApi.me()` is called today
   (against the MSW mock) to restore a session on page load. Because this
   plan only binds routes that already exist, `/auth/me` is not implemented
   here — meaning the frontend cannot fully cut over from MSW to the real
   API for its login/session-restore flow until a follow-up phase adds it.
   In principle it's small (`authenticateCookie` already returns the
   `UserSnapshot` such a handler would serialize), but writing it is an
   `apps/api/src` code change, out of scope for this docs-only task.
   Flagging now so it isn't rediscovered mid-implementation.

7. **`FALCON_DATABASE_URL` vs. the existing `DATABASE_URL`.** The only
   existing runtime-adjacent env-var precedent (`FALCON_POSTGRES_URL`,
   test-only) uses a `FALCON_` prefix; the root `.env.example`'s
   `DATABASE_URL`/`POSTGRES_*`/`REDIS_URL`/`S3_*` do not. §2 defaults to
   `FALCON_`-prefixed names for `apps/api`'s new runtime env vars for
   consistency with that one precedent, but does not resolve whether
   `DATABASE_URL` itself should be renamed or aliased.

8. **Two route-shape choices in §11 need explicit sign-off, not just
   adoption:** binding `mapJourneyService`/`unmapJourneyService` both under
   one `PUT /journeys/:id/services` path, and the proposed (undocumented)
   `PUT /roles/:roleId/field-visibility/:fieldId` path for
   `upsertFieldVisibility`.

9. **`getLeadById` vs. `getSeller360` both target `GET /leads/:id`.** This
   plan binds the path to `getSeller360`; `getLeadById`'s removal is a
   follow-up cleanup, not required for this phase.

## Test plan

- **New: HTTP contract tests** (`apps/api/src/__tests__/http/*.contract.test.ts`)
  built on `build-server.ts`'s `buildServer(deps)` factory, exercising bound
  endpoints over **real HTTP** — Fastify's `.inject()` (drives the full
  request pipeline — routing, hooks, plugins, serialization — without a real
  socket) for most cases, and a real `fastify.listen({ port: 0 })` + `fetch()`
  for behavior that only manifests over an actual socket (real `Set-Cookie`
  round-tripping the way a browser would, CORS preflight `OPTIONS` handling,
  rate-limit response headers). At minimum:
  - Login → cookie issued → an authenticated call using that literal cookie
    value succeeds → logout clears it → a subsequent authenticated call
    401s. This is the one behavior direct function invocation cannot verify,
    since it depends on real cookie header round-tripping.
  - Unauthenticated requests to every bound authenticated route return 401
    before reaching the route function (proving the preHandler actually
    blocks, not just that the route function itself would 403).
  - CORS preflight succeeds for the configured origin and is rejected for an
    arbitrary other origin.
  - Repeated failed logins trip `@fastify/rate-limit` (429) independent of
    the application-level lockout, proving both layers are wired.
  - The route-result → HTTP status/error-body mapping (§4) round-trips
    correctly for at least one 400/403/404/409 case per module.
  - `GET /health` returns 200 with no auth required.
- **Relationship to the existing Testcontainers integration suites**
  (`apps/api/src/__tests__/*.integration.test.ts`, e.g.
  `leads.integration.test.ts`, `auth-flow.integration.test.ts`): those
  suites already prove the route functions behave correctly against real
  Postgres by calling the functions **directly**, with no HTTP involved —
  that coverage is not duplicated or replaced here. The new HTTP contract
  tests complement it by proving the **transport wiring** (cookie handling,
  status/error mapping, CORS, rate limiting, logging hook presence) is
  correct. Contract tests that need real persistence (e.g. the
  login→cookie→authenticated-call flow) should use the same
  `shouldRunPostgresIntegration`/`FALCON_POSTGRES_URL` Testcontainers
  convention already established in
  `apps/api/src/__tests__/fixtures/synthetic-auth.ts`; contract tests that
  only need to prove HTTP-layer behavior (CORS, rate-limit, health) can use
  lightweight stub repositories, matching the existing unit-vs-integration
  split (`leads.test.ts` vs `leads.integration.test.ts`).
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` must all pass from
  the repo root per `docs/testing/quality-gates.md`'s Definition of Done,
  including strict-TypeScript checks that Fastify's generic route typing
  doesn't leak `any` into the existing route-function call sites.
- **`apps/web`/MSW:** this plan does not modify `apps/web/src/mocks/*` or
  `main.tsx`'s MSW bootstrap — that's a separate, explicitly-sequenced
  follow-up once Risk #3 (MSW retention) and Risk #6 (`/auth/me`) are
  resolved. When that follow-up happens, the switch is expected to be
  config-level, not a rewrite: `apps/web/src/lib/api-client.ts` already
  calls the real relative paths with `credentials: 'include'`, so cutting
  over is primarily gating `main.tsx`'s `enableMocking()` behind an explicit
  flag rather than unconditional `import.meta.env.DEV`, plus whatever
  CORS/proxy configuration Risk #2 settles on.
- Load/performance testing against the 200k-record targets in
  `docs/testing/quality-gates.md` is explicitly not part of this plan — no
  Seller List/search implementation work happens here, only transport
  binding for endpoints that already exist.

## Rollback plan

- This plan introduces **no database schema migration** — no
  `packages/database/prisma/migrations/*` changes are proposed;
  `createPrismaClient()` (§9) only constructs a client against the existing
  generated schema.
- Rolling back the Fastify server after a deploy is a normal code revert of
  the new `apps/api/src/http/*`, `env.ts`, `main.ts` files and the
  `apps/api/package.json` dependency additions. `apps/api/src/routes/*.ts`
  and everything beneath them are untouched by this plan, so rolling back
  the transport layer alone cannot corrupt or lose any Lead/Seller/
  configuration/auth data — the worst case is the API becomes unreachable
  again (equivalent to today's OD-020 state), not data loss.
- Because Prisma connects lazily and `main.ts` owns the only `PrismaClient`
  instance for `apps/api`, a rollback that removes `main.ts` entirely
  removes the only runtime consumer of that client — no dangling
  connections or migration state to clean up.
- Session cookies issued by a rolled-back deploy remain valid (sessions are
  server-side rows, not tied to the HTTP framework version) — a transport-
  only rollback does not force logout. A rollback that also reverts an
  `AuthConfig` value changed to resolve Risk #1 (e.g. `sameSite`/
  `secureCookies`) could affect previously-issued cookies' expectations and
  should be called out in that specific deploy's own rollback notes, not
  assumed here.
