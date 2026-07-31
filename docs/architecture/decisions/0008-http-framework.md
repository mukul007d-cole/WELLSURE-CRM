# ADR-0008: HTTP Framework for apps/api

**Status:** Accepted

## Context

OD-020 (`docs/requirements/open-decisions.md`) records that `apps/api` has no
real HTTP server. The route functions in `apps/api/src/routes/auth.ts`,
`configuration.ts`, and `leads.ts` already exist, are unit-tested in
isolation, and (for auth and leads flows) are exercised against real
PostgreSQL through a Testcontainers-backed integration suite
(`apps/api/src/__tests__/*.integration.test.ts`). Every one of those route
functions already takes a plain input object and returns a plain `{ status,
headers?, body }` result — there is no HTTP-framework type anywhere in
`apps/api/src/routes/` or the service/repository layers beneath them. But
nothing binds any of this to an actual HTTP method + path over a network
port: `apps/api/package.json` has no Express/Fastify/Hono/etc. dependency
(only `@falcon/permission-engine` and `argon2`), and there is no
`server.ts`/`app.ts`. `docs/api/endpoints.md` documents the target REST
contract, not a running API.

In the meantime, `apps/web` was built against that documented contract using
MSW (`apps/web/src/mocks/`) as a dev-only mock layer, so there is already a
concrete, working consumer of the eventual HTTP contract: cookie-based
session auth (`fetch(..., { credentials: 'include' })`), JSON request/response
bodies, and an error body shape.

This ADR resolves only the framework choice. It does not implement the
server, does not decide the composition-root/bootstrap design, and does not
resolve open contract questions surfaced while researching it — those are
recorded in `docs/planning/phase-6-http-transport-plan.md`, Risks / open
questions.

## Options considered

**Fastify** — schema-driven request/response validation and serialization, a
built-in Pino logger with per-request child loggers and request-ID
generation out of the box, and a mature, officially-maintained (`@fastify/*`)
plugin set covering exactly the mechanisms this project already needs:
cookies, CORS, rate limiting, and OpenAPI generation. Fastify's encapsulation
model (plugins/contexts) maps cleanly onto keeping route functions as plain,
framework-agnostic exports and writing thin adapters that translate
`FastifyRequest`/`FastifyReply` into the existing call signatures. Mature
Node.js/TypeScript support, actively maintained, well suited to the ECS
Fargate/Node deployment target in `docs/operations/runbook.md`.

**Express** — the most widely adopted option, but it has no built-in schema
validation/serialization, no built-in structured logging, and no built-in
OpenAPI generation. Each of the four documented plugin requirements below
(cookies, CORS, rate limiting, structured logging + correlation IDs,
OpenAPI) would need a separately-sourced, separately-maintained middleware
package of varying quality (`cookie-parser`, `cors`, `express-rate-limit`,
`pino-http`/`morgan`, and a reflection-based OpenAPI generator such as
`swagger-jsdoc` that infers schemas from comments rather than validating
against real route schemas, so the generated spec can drift from actual
behavior). Not rejected for performance — V1's targets (100 concurrent
users, sub-2s list p95, per `docs/testing/quality-gates.md`) don't stress
either framework — but rejected because assembling an equivalent plugin
surface costs more and yields weaker guarantees (schema-drift risk
specifically) than Fastify's first-party ecosystem for the requirements this
decision has to satisfy.

**Hono** — modern, fast, strong TypeScript-first design, and portable across
edge runtimes (Workers/Deno/Bun/Node). Falcon V1 has no edge/multi-runtime
requirement — `docs/operations/runbook.md` targets ECS Fargate on Node
specifically — so Hono's main differentiator doesn't apply here. Its Node.js
plugin ecosystem for this project's specific needs (a session-cookie auth
flow as mature as `@fastify/cookie`, rate limiting scoped to auth endpoints,
OpenAPI generation from real route schemas) is younger and thinner than
Fastify's. Rejected for ecosystem-maturity risk relative to Fastify, not for
any technical deficiency.

**`node:http`** — zero framework dependency, full control, smallest possible
surface. Falcon already hand-rolls its own cookie *value* encoding in
`apps/api/src/auth/cookies.ts` per ADR-0007, so that part isn't a
differentiator either way. But routing, body parsing, CORS preflight
handling, rate limiting, and OpenAPI generation would all need to be
hand-built or hand-assembled from smaller, less-audited libraries — a
meaningfully higher implementation and ongoing security-maintenance cost for
a small team than adopting a framework, for no corresponding benefit; Falcon
is not latency- or footprint-constrained enough to justify avoiding a
framework. Rejected on cost/risk versus benefit.

## Decision

`apps/api` will use **Fastify** as its HTTP framework, with the following
first-party plugins. Each is included because it satisfies a specific,
already-documented requirement — not speculatively:

| Plugin | Pinned version | Documented requirement it satisfies |
|---|---|---|
| `fastify` | `5.11.0` | The framework itself. |
| `@fastify/cookie` | `11.1.2` | Cookie handling for the ADR-0007 session cookie. This decorates `request`/`reply` with convenient cookie access at the transport layer; it does **not** replace the already-tested `serializeSessionCookie` / `serializeClearedSessionCookie` / `parseCookie` functions in `apps/api/src/auth/cookies.ts`, which remain the source of truth for the session cookie's name, `HttpOnly`/`Secure`/`SameSite` attributes, and value encoding per ADR-0007. |
| `@fastify/cors` | `11.3.0` | The CORS policy needed for credentialed requests from the `apps/web` origin (`docs/api/endpoints.md`). Exact origin/credentials configuration is implementation detail — see the phase-6 plan's open dev-proxy question. |
| `@fastify/rate-limit` | `11.2.0` | "Rate limiting on auth endpoints specifically (lockout after repeated failed logins)" (`docs/api/endpoints.md`, Standards). HTTP-layer defense in depth alongside the already-implemented application-level lockout in `apps/api/src/auth/login.ts` (`lockoutMaxAttempts` / `lockoutWindowMs` / `lockoutDurationMs`), not a replacement for it. |
| `pino` (Fastify's built-in logger) | `10.3.1` | Structured logging with correlation/request IDs on every request (`docs/operations/runbook.md`, Monitoring). Configured with an explicit `redact` list so no credential, session token, cookie, or personal-data field is ever logged — enforced by configuration, not convention. |
| `@fastify/swagger` | `9.8.1` | OpenAPI generation (`docs/api/endpoints.md`: "Versioned under `/api/v1` ... REST, OpenAPI-documented"). Generates the spec from real Fastify route schemas rather than a hand-maintained document that can drift from behavior. |
| `@fastify/swagger-ui` | `6.1.1` | Serves the generated OpenAPI document as browsable interactive documentation. |

Exact wiring, bootstrap structure, environment configuration, and the
per-route schema definitions needed to drive `@fastify/swagger` are
implementation detail, not part of this decision — see
`docs/planning/phase-6-http-transport-plan.md`.

## Rationale

The deciding factor is fit against requirements Falcon has already written
down, not a generic "best framework" judgment: `docs/api/endpoints.md` and
`docs/operations/runbook.md` already call for cookie-based session auth,
CORS, auth-endpoint rate limiting, structured/correlated logging, and OpenAPI
documentation. Fastify is the only option evaluated where all five are
covered by actively maintained, first-party (`@fastify/*` org, or built-in)
packages rather than a self-assembled combination of third-party middleware
of uneven maintenance quality. Node.js on ECS Fargate is the confirmed
deployment target (`docs/operations/runbook.md`), so Hono's edge-portability
advantage doesn't apply, and V1's load targets (100 concurrent users, p95
<2s reads / <1s writes — `docs/testing/quality-gates.md`) don't come close to
requiring `node:http`'s minimal overhead.

## Consequences

`apps/api/package.json` gains its first HTTP-framework dependency (currently
only `@falcon/permission-engine` and `argon2`), plus the plugins above — a
concrete change that must be called out in the phase-6 implementation PR per
`AGENTS.md`'s "explain why" rule for new production dependencies (this ADR is
that explanation).

Because every route function in `apps/api/src/routes/` and the service/
repository layers beneath them already takes and returns plain objects with
no framework type in their signatures, this decision is **reversible at
comparatively low cost**: swapping frameworks later means rewriting the thin
HTTP-adapter layer (request/reply translation, the cookie/auth
`preHandler`, CORS/rate-limit registration, the logging hook, and the
OpenAPI schema wiring), not the tested business logic. This is not a
zero-cost reversal — hooks, plugin registration, and any Fastify route
schemas used to drive `@fastify/swagger` are Fastify-specific and would need
to be re-authored for a different framework — but it is materially cheaper
than a typical framework migration because the route layer was already kept
transport-agnostic before this decision was made. Do not read "reversible"
as "free."

This decision does **not** resolve the exact HTTP error-response envelope.
The route layer already returns `{ error: string, details?: Record<string,
unknown> }` (a flat error-code string) — consistently implemented across
`apps/api/src/routes/*.ts`, `apps/web/src/lib/api-client.ts`, and the MSW
mock handlers in `apps/web/src/mocks/handlers.ts` — while
`docs/api/endpoints.md`'s Standards section states `{ error: { code,
message, details? } }` (a nested object). A code comment in
`apps/web/src/types/domain.ts` already flags this directly: `ApiErrorBody`
is documented there as "the real code, not endpoints.md's stale
{code,message} shape." Fastify does not need this resolved to be adopted —
`@fastify/swagger`'s generated schema will document whatever shape the error
mapping in the transport layer actually produces — but the shape must be
decided before the OpenAPI document is finalized. See the phase-6 plan's
Risks / open questions; this ADR does not pick a side.

If a future requirement (e.g. an edge/multi-runtime deployment target)
changes the calculus above, that must be recorded in a new ADR that
supersedes this one, not an ad hoc framework swap.
