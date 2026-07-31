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
`apps/api/src/auth/{middleware,cookies,session,config,login}.ts`,
`apps/api/src/leads/validation.ts`,
`apps/api/src/__tests__/leads.integration.test.ts`,
`apps/api/src/__tests__/fixtures/synthetic-auth.ts`,
`packages/database/{package.json,src/index.ts,prisma/schema.prisma}`,
`packages/permission-engine/src/decision.ts`,
`packages/observability/src/index.ts`,
`apps/web/src/lib/{api-client.ts,api-error.ts}`, `apps/web/src/types/domain.ts`,
`apps/web/src/mocks/{handlers.ts,session.ts,browser.ts}`,
`apps/web/src/main.tsx`, `apps/web/vite.config.ts`, `apps/web/vitest.config.ts`,
`apps/web/src/test/setup.ts`, root `package.json`, `.env.example`,
`docker-compose.yml`, `eslint.config.ts`, `infra/terraform/modules/{network,compute}/README.md`.

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
  result, using the flat error shape.** `LeadRouteResult` and
  `ConfigurationRouteResult` are both `{ status: 200|201; body } | { status:
  400|403|404|409; body: { error: string; details?: Record<string,
  unknown> } }`; `routes/auth.ts`'s ad hoc return types match the same flat
  shape. **This is now confirmed correct and documented** — see Risks /
  open questions, item 2 (RESOLVED) and §5 below; `docs/api/endpoints.md`
  has been corrected to match, and no further reconciliation work is needed
  before the route-result mapper (§5) is implemented.
- **`authenticateCookie` already does the session-middleware work.**
  `apps/api/src/auth/middleware.ts`'s `authenticateCookie({ repository,
  config, cookieHeader })` takes a raw `Cookie` header string and returns
  `AuthenticatedContext { user: UserSnapshot; session: SessionRecord } |
  null` — `UserSnapshot` is exactly the shape `resolveAuthorization` (the
  permission engine) consumes. No new session/user-snapshot construction
  logic is needed; only a thin Fastify `preHandler` around this function.
- **`login()`'s failure reasons are narrower than the login UX eventually
  needs.** `apps/api/src/auth/login.ts`'s `LoginResult` only distinguishes
  `'INVALID_CREDENTIALS' | 'LOCKED_OUT'`; a deactivated user
  (`user.active === false`) deliberately falls into `INVALID_CREDENTIALS`
  alongside a wrong password, using a constant-time dummy-hash comparison
  (`getDummyHash()`) to prevent timing-based account enumeration. `routes/auth.ts`'s
  `loginRoute` currently maps both reasons to the *same* response body
  (`{ error: 'invalid_credentials' }`), varying only the HTTP status (423 vs
  401). See §5 for the resolution.
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
- **`apps/web` already has a working consumer of the target contract, and
  the dev-time transport path is now decided (§3).**
  `apps/web/src/lib/api-client.ts` calls `fetch('/api/v1' + path, {
  credentials: 'include', ... })`. `apps/web/vite.config.ts` has no
  `server.proxy` entry today — in dev this currently only "works" because
  MSW's service worker intercepts the request at the network layer
  regardless of same-origin/proxy configuration, not because a proxy
  exists. MSW starts unconditionally in dev via `main.tsx`'s
  `import.meta.env.DEV` gate (`onUnhandledRequest: 'bypass'`), using
  `apps/web/src/mocks/browser.ts`'s `setupWorker`.
- **MSW is not wired into `apps/web`'s test suite today.**
  `apps/web/vitest.config.ts`'s `setupFiles` points at
  `apps/web/src/test/setup.ts`, which only wires `@testing-library/jest-dom`
  and DOM cleanup — it does not start an MSW Node server (`msw/node`'s
  `setupServer`). None of the five existing `apps/web/src/**/*.test.{ts,tsx}`
  files call through `api-client.ts`/`fetch`. So "retain MSW for tests" (§13)
  is net-new wiring, not preserving something that already runs.
- **`packages/observability/src/index.ts` is an empty placeholder** — no
  existing logging conventions to reuse; this phase introduces the first
  ones.
- **`infra/terraform/modules/{network,compute}` are still Phase-1
  placeholders** — each module's `README.md` states "Phase 1 intentionally
  contains no resources." There is no committed ALB/CloudFront routing rule
  or domain/subdomain assignment yet for staging/production. See §3.
- **Route coverage against `docs/api/endpoints.md` is partial.** Enumerated
  precisely in §12, since the exact existing/missing split drives what this
  plan is allowed to bind versus must defer.
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
  functions and translate results (see §5).
- `apps/api/src/http/plugins/{cookies,cors,rate-limit,logging,openapi}.ts` —
  one file per cross-cutting concern (§4, §6, §7, §8, and OpenAPI wiring).
- `apps/api/src/env.ts` — fail-fast environment parsing (§2).
- `apps/api/src/main.ts` — the actual process entry point: reads env,
  constructs the Prisma client and repositories, calls `buildServer(...)`,
  calls `.listen()`, and wires graceful shutdown (§11). This is the only
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
- `FALCON_SESSION_COOKIE_SECURE`, exposed so `AuthConfig.secureCookies` can
  differ across dev/staging/production per §3
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

### 3. Cross-environment origin, dev proxy, and cookie policy — RESOLVED

**Decision:** `apps/web` uses a Vite dev proxy, not direct cross-origin
calls. `apps/web/vite.config.ts` gets a `server.proxy` entry routing `/api`
to the Fastify server's dev port (e.g. `{ '/api': { target:
'http://localhost:<FALCON_HTTP_PORT>', changeOrigin: true } }`).

**Consequence for dev:** the browser sees same-origin requests (everything
served from `localhost:5173`), so the session cookie stays `SameSite=Lax`
with no cross-site cookie handling needed, and `FALCON_SESSION_COOKIE_SECURE`
can be `false` in local dev (plain HTTP over `localhost`) without weakening
anything, since there's no cross-site request to protect against in dev in
the first place.

**Intent for staging and production:** serve the API under the same *site*
as the web app (e.g. `app.<domain>` and `api.<domain>` under one
registrable domain, or a single origin with `/api` path-routed to the API
service), so the cookie policy is `SameSite=Lax` + `Secure: true` **once**,
identically, across all three environments — not three special cases.
`SameSite` is evaluated against the registrable "site" (eTLD+1), not the
exact origin, so same-registrable-domain subdomains for web and API already
qualify as same-site without needing to be same-origin.

**This intent is not yet confirmed by the actual Terraform layout — flagged,
not assumed.** `infra/terraform/modules/network/README.md` and
`infra/terraform/modules/compute/README.md` both state: "Phase 1
intentionally contains no resources." There is no committed ALB listener
rule, CloudFront behavior, Route 53 record, or domain/subdomain assignment
yet that would prove web and API end up same-site in staging/production.
Whoever builds out the staging/production Terraform environments needs to
either confirm a same-site domain plan (so this policy holds unmodified) or
come back and revisit the cookie `SameSite`/CORS configuration explicitly —
this plan does not assume the infra will land that way.

### 4. Session cookie middleware

A Fastify `preHandler`, registered on an authenticated-routes plugin scope
(not globally — login/password-reset endpoints must stay reachable
unauthenticated), that:

1. Reads the raw `Cookie` header from `request.headers.cookie`.
2. Calls the existing `authenticateCookie({ repository: sessionRepository,
   config: authConfig, cookieHeader })` unchanged — no new session/user-
   snapshot logic is written here.
3. On `null`, replies `401` with `{ error: 'unauthenticated' }` (§5),
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

### 5. Mapping route results to HTTP status codes and the error shape — RESOLVED

Every existing route function already returns a discriminated `{ status,
headers?, body }` object. The Fastify handler for each bound endpoint is
therefore mechanical: apply any `headers` from the result via
`reply.header(...)`, then `reply.status(result.status).send(result.body)`.

**Resolved 2026-07-31:** the error envelope is the flat `{ error: string,
details?: Record<string, unknown> }` shape already implemented in
`apps/api/src/routes/*.ts`, `apps/web/src/lib/api-client.ts`, and the MSW
handlers. `docs/api/endpoints.md` was stale and has been corrected to match
(full history in Risks / open questions, item 2). This means the mapper
above needs **no transformation of the body at all** — `result.body` is
already the wire shape; its only job is the generic status/headers plumbing.
`@fastify/swagger`'s generated error schema documents `{ error: string,
details?: object }` directly, with no separate shaping step to design.

**Follow-up required at implementation time, not done in this docs-only
pass:** the `ApiErrorBody` comment at `apps/web/src/types/domain.ts:162`
currently reads "matches the real code, not endpoints.md's stale
{code,message} shape" — that sentence is now inaccurate (`endpoints.md` is
corrected) and needs updating when Phase 6 touches `apps/web/src`.

**Login-route error-code distinguishability (part of the auth-route mapping
work):** because the flat shape's only machine-readable signal is the
`error` string itself, `loginRoute` needs a closer look at what it currently
emits for its two failure reasons, which collapse to the same body today:

```ts
return {
  status: result.reason === 'LOCKED_OUT' ? 423 : 401,
  body: { error: 'invalid_credentials' },
};
```

- **Lockout vs. invalid credentials (ADR-0007):** already distinguishable
  today via HTTP status alone (`423` vs `401`), independent of the error-
  shape decision. Phase 6 implementation should still emit a distinct
  `error` code per reason (e.g. `error: 'account_locked'` for `LOCKED_OUT`,
  `error: 'invalid_credentials'` for `INVALID_CREDENTIALS`) so the frontend
  has a stable, explicit signal instead of branching on HTTP status codes —
  a one-line change to the ternary above.
- **Deactivated account vs. invalid credentials: intentionally *not*
  distinguished**, and this plan does not propose adding a distinction.
  `apps/api/src/auth/login.ts`'s `LoginResult` only ever returns
  `'INVALID_CREDENTIALS' | 'LOCKED_OUT'` — a deactivated user
  (`user.active === false`) already falls into the same
  `INVALID_CREDENTIALS` path as a wrong password or nonexistent email,
  deliberately, using a constant-time dummy-hash comparison
  (`getDummyHash()`) specifically to prevent timing-based account
  enumeration. This matches the enumeration-avoidance principle
  `docs/api/auth.md` already states for `POST /auth/password-reset/request`
  ("always returns an accepted response to avoid account enumeration").
  Revealing "this account is deactivated" as a distinct login error would
  let an attacker enumerate deactivated accounts by password-guessing
  against them, without ever triggering the "wrong password" signal — a
  real regression from the current design. If product later wants that
  usability tradeoff anyway, it needs its own explicit decision; Phase 6
  should not introduce it as a side effect of the transport work.

### 6. CORS

`@fastify/cors` registered with `credentials: true` and an explicit origin
allow-list sourced from `FALCON_CORS_ORIGIN` (never `*`, which the Fetch
spec forbids combining with credentialed requests). With the dev-proxy
decision in §3, dev traffic to the API never needs cross-origin CORS at all
(the browser only ever talks to `localhost:5173`); `@fastify/cors` still
needs to be registered and configured correctly for staging/production and
for any direct-to-API tooling (e.g. `@fastify/swagger-ui`'s "try it"
requests, or a future non-proxied client), using whatever origin(s) the
same-site domain plan in §3 settles on.

### 7. Rate limiting

`@fastify/rate-limit` registered only on the auth-endpoint plugin scope
(`/api/v1/auth/*`), keyed by normalized email + IP consistent with the
existing lockout keying in `apps/api/src/auth/login.ts`, as an HTTP-layer
defense-in-depth complement to — not a replacement for — the already-
implemented application-level lockout (`AuthConfig.lockoutMaxAttempts` /
`lockoutWindowMs` / `lockoutDurationMs`).

### 8. Request-scoped structured logging with correlation IDs

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

### 9. Health endpoint

`GET /health` — unauthenticated, and outside `/api/v1` since it's an infra
liveness concern, not a business endpoint — registered directly in
`build-server.ts`, not backed by any route function (there is nothing to
bind; it's new). Returns `200 { status: 'ok' }` when the process can respond
at all. A readiness variant that also checks the Prisma connection is a
reasonable follow-up but isn't required to satisfy this plan's health-
endpoint requirement, so it's noted as optional rather than assumed.

### 10. Prisma client lifecycle

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

### 11. Graceful shutdown

`main.ts` registers `SIGTERM`/`SIGINT` handlers that: stop accepting new
connections via `fastify.close()` (which drains in-flight requests before
resolving), then call `prismaClient.$disconnect()`, then exit. This matters
directly for ECS Fargate task replacement (`docs/operations/runbook.md`),
where a running task receives `SIGTERM` before forced termination.

### 12. Binding existing routes — and explicitly not inventing missing ones

**Auth** (`apps/api/src/routes/auth.ts`):

| Function | Method + path | Notes |
|---|---|---|
| `loginRoute` | `POST /api/v1/auth/login` | Matches `docs/api/auth.md`. See §5 for the lockout error-code follow-up. |
| `logoutRoute` | `POST /api/v1/auth/logout` | Requires the session-cookie preHandler (needs `sessionId`/`organizationId`/`actorUserId` from `request.auth`). |
| `requestPasswordResetRoute` | `POST /api/v1/auth/password-reset/request` | Unauthenticated. |
| `completePasswordResetRoute` | `POST /api/v1/auth/password-reset/complete` | Unauthenticated. |

`GET /auth/me` and `POST /auth/refresh` — both listed in
`docs/api/endpoints.md`'s Auth section — have **no backing route function**:
no `meRoute`, no session-refresh logic anywhere in `apps/api/src/auth/`.
Not implemented here; see Risks, item 3 (this directly blocks retiring MSW
for the frontend's session-restore flow — §13 — since
`apps/web/src/lib/api-client.ts`'s `authApi.me()` already calls it against
the mock).

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
| `mapJourneyService` / `unmapJourneyService` | both under `PUT /api/v1/journeys/:journeyId/services` | See note below. |
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
functions are two separate create/delete-mapping calls). **Decided:** keep
them as two calls dispatched under one path (e.g. by an `action` field);
this is an implementation-time detail the Phase 6 implementer finalizes and
records in `docs/api/endpoints.md`, not a blocker for approving this plan.

`upsertFieldVisibility` sets a `(field, role)` → `VIEW`/`EDIT` row in
`field_visibility` — the access-model's field-level visibility mechanism —
but `endpoints.md` has no endpoint for it at all; its nearest neighbor, `PUT
/journeys/:id/fields/:fieldId`, is documented as being about a Journey's
`requirement`/`required_from_status`/visibility settings
(`field_journey_settings`, a different table with no implemented mutation
function). **Decided:** the Phase 6 implementer picks the final path (`PUT
/roles/:roleId/field-visibility/:fieldId` is this plan's proposal) and
records it in `docs/api/endpoints.md` at implementation time — also not a
blocker for approving this plan.

**Leads** (`apps/api/src/routes/leads.ts`):

| Function | Method + path | Notes |
|---|---|---|
| `listSellers` | `GET /api/v1/leads` | `journeyId` genuinely optional — all-Journeys behavior is approved and implemented; see Risks, item 1 (RESOLVED). |
| `createLead` | `POST /api/v1/leads` | |
| `getSeller360` | `GET /api/v1/leads/:id` | Matches the documented Phase 5 contract (journey/status objects, assignments). |
| `editLead` | `PATCH /api/v1/leads/:id` | Already handles core-field edits **and** status transitions in one call. |

`getLeadById` (the `LeadReadRepository`-backed function, returning the
simpler `LeadDetailRecord` shape with no assignments/journey names) also
exists and would collide with `getSeller360` on the same `GET
/api/v1/leads/:id` path. `docs/planning/phase-5-lead-seller-core-plan.md`
itself calls it "the legacy/simple lead detail path if it remains exported"
— its status was already ambiguous before this task. **Decided:** bind `GET
/api/v1/leads/:id` to `getSeller360` (it matches the documented contract)
and leave `getLeadById` unbound; whether to delete it is a follow-up
`apps/api/src` cleanup the implementer resolves and documents during Phase
6, not a blocker for approving this plan.

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

### 13. Retiring MSW from the dev runtime path (frontend cutover) — RESOLVED

**Decision:** MSW is retained for `apps/web` unit/component tests only. It
is removed from the dev runtime path once the real API is reachable through
the Vite dev proxy (§3).

**What this changes, precisely** (all `apps/web/src`, out of scope for this
docs-only plan itself — implementation-time work, sequenced after §1–§12):

- `apps/web/src/test/setup.ts` — add `msw/node`'s `setupServer(...handlers)`
  with `beforeAll(() => server.listen(...))` / `afterEach(() =>
  server.resetHandlers())` / `afterAll(() => server.close())`. This is
  **new** wiring — see Current state: no test currently starts an MSW
  server. `apps/web/vitest.config.ts`'s existing `setupFiles` entry already
  points at this file, so the config itself doesn't need to change.
- `apps/web/src/mocks/handlers.ts`, `fixtures.ts`, `permissions.ts`,
  `session.ts` — retained as-is; they become test-only fixtures instead of
  dev-runtime fixtures. No content changes required by this decision alone.
- `apps/web/src/mocks/browser.ts` (`setupWorker`) — removed, or kept but no
  longer imported from `main.tsx`'s dev path.
- `apps/web/src/main.tsx` — `enableMocking()`'s unconditional
  `import.meta.env.DEV` gate is removed so local dev talks to the real API
  (through the Vite proxy from §3) by default.

**What proves the switchover worked:**

1. The net-new `setupServer` wiring must be proven *before*
   `main.tsx`'s dev-runtime MSW bootstrap is removed, so no existing test
   coverage silently loses its mock backend mid-transition: add or update
   at least one `apps/web` test that exercises a real `api-client.ts` call
   through the retained `handlers.ts` via the Node server, and confirm it
   passes.
2. After `main.tsx`'s dev-runtime gate is removed, a manual/documented
   dev-mode smoke check (`pnpm dev`, log in through the UI) must show the
   request actually leaving the browser and hitting the real Fastify
   server — visible as a real network response in devtools (not "served
   from ServiceWorker") and as a corresponding correlated log line from §8
   on the API side, not a fabricated 200 from MSW.
3. An E2E/Playwright smoke path (per the test shells already established in
   P1-10, `docs/planning/phase-1-backlog.md`) exercising login end-to-end
   against the real dev-proxied API, with MSW's browser worker not
   registered, is the strongest proof and should be added once this
   phase's HTTP contract tests are green.

**Sequencing:** this section depends on `/auth/me` existing (Risks, item 3,
still open) for the frontend's session-restore flow to work without MSW —
full MSW dev-runtime removal is realistically a follow-up phase, not this
one. What this plan commits to now is the target end-state and the specific
files/proof points, not doing the `apps/web/src` edits themselves.

## Files to touch

- `apps/api/package.json` — add `fastify`, `@fastify/cookie`,
  `@fastify/cors`, `@fastify/rate-limit`, `@fastify/swagger`,
  `@fastify/swagger-ui`, and `@falcon/database` (workspace) as dependencies.
- `apps/api/src/index.ts` — add the missing `routes/auth.ts` wrapper exports
  (§1); no other change.
- `apps/api/src/env.ts` (new)
- `apps/api/src/main.ts` (new)
- `apps/api/src/http/build-server.ts` (new)
- `apps/api/src/http/errors.ts` (new) — the route-result → HTTP mapper (§5);
  now a thin passthrough, since the error-shape question is resolved
- `apps/api/src/http/plugins/cookies.ts` (new)
- `apps/api/src/http/plugins/cors.ts` (new)
- `apps/api/src/http/plugins/rate-limit.ts` (new)
- `apps/api/src/http/plugins/logging.ts` (new)
- `apps/api/src/http/plugins/openapi.ts` (new)
- `apps/api/src/http/routes/auth.ts` (new) — includes the lockout error-code
  follow-up from §5
- `apps/api/src/http/routes/configuration.ts` (new)
- `apps/api/src/http/routes/leads.ts` (new)
- `apps/api/src/http/routes/health.ts` (new)
- `apps/api/src/__tests__/http/*.contract.test.ts` (new)
- `packages/database/src/index.ts` — add `createPrismaClient()` export
- `.env.example` (root) — add `FALCON_HTTP_PORT`, `FALCON_CORS_ORIGIN`,
  `FALCON_LOG_LEVEL`, `FALCON_SESSION_COOKIE_SECURE`, and (pending the
  naming question in Risks, item 4) either rename or add
  `FALCON_DATABASE_URL`
- `apps/web/vite.config.ts` — add the `server.proxy['/api']` entry (§3,
  decided; no longer conditional)
- `docs/api/endpoints.md` — the error-envelope correction is already done
  (this pass); still pending real implementation: the actually-bound paths
  from §12, `upsertFieldVisibility`'s path, and the `PUT
  /journeys/:id/services` map/unmap shape

**MSW retirement follow-up (§13; sequenced after the above, depends on
Risks item 3 being resolved first):**

- `apps/web/src/test/setup.ts` — add `msw/node` `setupServer` wiring (new)
- `apps/web/src/mocks/browser.ts` — remove or stop importing from `main.tsx`
- `apps/web/src/main.tsx` — remove the unconditional dev-mode MSW bootstrap
- `apps/web/src/types/domain.ts` — correct the now-stale `ApiErrorBody`
  comment at line 162 (§5)

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
- No endpoints beyond the ones enumerated in §12 as already implemented —
  anything `endpoints.md` documents without a backing route function is
  explicitly deferred to a later phase, not built here.
- No change to route/service/repository/permission-engine business logic —
  this is a transport layer around what already exists and already passes
  its own tests.

## Risks / open questions

Two items below are resolved and kept for their reasoning/history, not as
open items; two remain genuinely open.

1. **Seller List all-Journeys — RESOLVED 2026-07-31.** This item's original
   framing — introduced by this task's own brief, describing the
   all-Journeys behavior as "still-unapproved" — was incorrect.
   `docs/api/endpoints.md` and `docs/planning/phase-5-lead-seller-core-plan.md`'s
   "Phase 5 Completion" section both already documented the all-Journeys
   aggregate view as approved and implemented before this plan was first
   written; the code (`packages/permission-engine/src/decision.ts`'s
   `journeyId === undefined` branch, and `listSellers` in
   `apps/api/src/routes/leads.ts`) matches that. §12's route binding already
   reflected this. `docs/planning/phase-5-lead-seller-core-plan.md`'s
   original "Approval required" bullet has been amended with a forward
   pointer to the Completion section (not deleted), so a future reader
   lands on the resolution instead of the superseded question. Kept here,
   with its reasoning, as a record of what this plan checked and why — not
   as an open item.

2. **`{ error: string }` vs. `{ error: { code, message, details? } }` —
   RESOLVED 2026-07-31.** Decision: the flat `{ error: string, details? }`
   shape already implemented across `apps/api/src/routes/*.ts`,
   `apps/web/src/lib/api-client.ts`, and the MSW handlers is correct.
   `docs/api/endpoints.md`'s Standards section was stale and has been
   corrected to document the flat shape (including that there is no
   separate `message` field — clients render their own copy from the code,
   as `apps/web/src/lib/api-error.ts`'s `FRIENDLY_MESSAGES` map already
   does). §5 above has been rewritten accordingly: the route-result → HTTP
   mapper needs no body transformation, and the `@fastify/swagger` error
   schema documents the flat shape directly. Two follow-ups fall out of
   this decision and are **not** done in this docs-only pass (both listed
   under Files to touch):
   - `apps/web/src/types/domain.ts:162`'s comment calling `endpoints.md`
     "stale" needs updating now that it no longer is.
   - `loginRoute`'s lockout-vs-invalid-credentials error code (§5).
   Kept here, with its reasoning, rather than deleted, since the "why"
   (three independent layers already agreeing with each other, one stale
   doc) is worth keeping visible.

3. **`GET /auth/me` and `POST /auth/refresh` have no backing implementation,
   and `apps/web` already depends on `/auth/me`.**
   `apps/web/src/lib/api-client.ts`'s `authApi.me()` is called today
   (against the MSW mock) to restore a session on page load. Because this
   plan only binds routes that already exist, `/auth/me` is not implemented
   here — meaning the frontend cannot fully cut over from MSW to the real
   API for its login/session-restore flow (§13) until a follow-up phase
   adds it. In principle it's small (`authenticateCookie` already returns
   the `UserSnapshot` such a handler would serialize), but writing it is an
   `apps/api/src` code change, out of scope for this docs-only task.
   Flagging now so it isn't rediscovered mid-implementation. **Still open.**

4. **`FALCON_DATABASE_URL` vs. the existing `DATABASE_URL`.** The only
   existing runtime-adjacent env-var precedent (`FALCON_POSTGRES_URL`,
   test-only) uses a `FALCON_` prefix; the root `.env.example`'s
   `DATABASE_URL`/`POSTGRES_*`/`REDIS_URL`/`S3_*` do not. §2 defaults to
   `FALCON_`-prefixed names for `apps/api`'s new runtime env vars for
   consistency with that one precedent, but does not resolve whether
   `DATABASE_URL` itself should be renamed or aliased. **Still open.**

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
  - Lockout returns 423 with `error: 'account_locked'` and plain invalid
    credentials returns 401 with `error: 'invalid_credentials'` — two
    distinct bodies, per §5's resolution — while a deactivated-account
    login attempt returns the *same* 401 `invalid_credentials` body as a
    wrong password (proving the deliberate non-distinction holds, not just
    that it's undocumented).
  - Unauthenticated requests to every bound authenticated route return 401
    before reaching the route function (proving the preHandler actually
    blocks, not just that the route function itself would 403).
  - CORS preflight succeeds for the configured origin and is rejected for an
    arbitrary other origin.
  - Repeated failed logins trip `@fastify/rate-limit` (429) independent of
    the application-level lockout, proving both layers are wired.
  - The route-result → HTTP status/error-body mapping (§5) round-trips
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
  `main.tsx`'s MSW bootstrap — §13 has the full decision, file list, and
  proof points for that follow-up, which still depends on Risks item 3
  (`/auth/me`) being implemented first.
- Load/performance testing against the 200k-record targets in
  `docs/testing/quality-gates.md` is explicitly not part of this plan — no
  Seller List/search implementation work happens here, only transport
  binding for endpoints that already exist.

## Rollback plan

- This plan introduces **no database schema migration** — no
  `packages/database/prisma/migrations/*` changes are proposed;
  `createPrismaClient()` (§10) only constructs a client against the existing
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
  `AuthConfig` value changed to resolve §3's cookie policy (e.g.
  `sameSite`/`secureCookies`) could affect previously-issued cookies'
  expectations and should be called out in that specific deploy's own
  rollback notes, not assumed here.
