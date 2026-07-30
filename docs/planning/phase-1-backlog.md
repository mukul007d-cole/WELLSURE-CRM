# Phase 1 Backlog — Foundation

## Outcome

Deliver a reproducible monorepo, local infrastructure, continuous-integration
quality gates, performance-test foundation, and baseline AWS Terraform structure
without implementing CRM business features or provider-specific authentication.
The foundation must support 100+ users, at least 200,000 seller records, and the
acceptance targets in `docs/testing/quality-gates.md`.

## Global definition of done

Every backlog item must satisfy the applicable checklist in
`docs/testing/quality-gates.md`: acceptance criteria met; tests updated and
passing; formatting, lint, type checks, and builds pass; relevant integration/E2E
checks pass; database rollback reviewed; permission and audit impact explicitly
reviewed; documentation updated; no secrets or real personal data committed;
self-review followed by human review.

Phase 1 introduces no production dependency without documenting why in the PR.
All images and tool versions are pinned deliberately and covered by the normal
dependency-update process.

## Sprint 1 — Repository and developer foundation

### P1-01 — Scaffold the pnpm/Turborepo workspace

- **Deliverable:** Root workspace configuration for `apps/{web,api,worker}` and
  `packages/{database,contracts,permission-engine,workflow-engine,validation,ui,
  observability,test-support}`, matching `AGENTS.md`.
- **Dependencies:** None.
- **Acceptance criteria:**
  - Pin the package manager and supported Node LTS version.
  - Root `dev`, `test`, `lint`, `typecheck`, `build`, and formatting commands run
    through the workspace task graph.
  - Package boundaries and dependency direction are documented; no cyclic
    workspace dependencies.
  - Placeholder packages contain tooling/config only, not CRM behavior or auth.
  - Fresh-clone setup steps replace the placeholder commands in `AGENTS.md`.
- **Verification:** Clean install plus all root commands on Linux.
- **Permission/audit review:** No runtime authorization or mutations introduced;
  record “not applicable” rather than omitting the review.
- **Estimate:** 3 points.

### P1-02 — Establish shared TypeScript and code-quality configuration

- **Deliverable:** Strict TypeScript, lint, formatter, test-runner, and source-map
  conventions shared by all workspaces.
- **Dependencies:** P1-01.
- **Acceptance criteria:**
  - Strict type checking is enabled with package-level project references or an
    equivalent scalable setup.
  - Lint rules prevent unsafe dependency direction and common async mistakes.
  - Import conventions do not wrap imports in `try/catch`.
  - Formatting can be checked without mutating files in CI.
  - A deliberately invalid fixture proves each quality command fails correctly,
    then is removed before merge.
- **Verification:** `pnpm lint`, `pnpm typecheck`, formatting check, and unit-test
  command all pass from the repository root.
- **Estimate:** 3 points.

### P1-03 — Define safe configuration and developer onboarding

- **Deliverable:** Environment-variable schema/conventions, redacted `.env.example`,
  setup documentation, and secret-handling guidance.
- **Dependencies:** P1-01.
- **Acceptance criteria:**
  - Examples contain local-only placeholders, never credentials or real personal
    data.
  - Startup fails clearly for missing/invalid required configuration.
  - Server-only values cannot be bundled into web/client configuration.
  - Documentation covers bootstrap, reset, troubleshooting, and data teardown.
- **Verification:** Secret scan and fresh-directory setup walkthrough.
- **Estimate:** 2 points.

## Sprint 1 — Local service environment

### P1-04 — Add pinned local Postgres orchestration

- **Deliverable:** Docker Compose service, health check, named volume, reset
  command, and connection conventions for PostgreSQL.
- **Dependencies:** P1-03.
- **Acceptance criteria:**
  - Postgres starts healthily from a clean machine and is not exposed beyond the
    local interface unnecessarily.
  - Database tooling has separate local/test databases and least-privilege role
    guidance.
  - Reset is explicit/destructive and documented.
  - Integration-test design uses real Postgres via Testcontainers, not mocks.
  - Migration conventions require reversibility or a documented rollback.
- **Verification:** Start, health-check, connect, persistence restart, reset, and
  Testcontainers smoke test.
- **Estimate:** 3 points.

### P1-05 — Add pinned local Redis orchestration

- **Deliverable:** Docker Compose Redis service with health check and documented
  queue/cache namespace conventions.
- **Dependencies:** P1-03.
- **Acceptance criteria:**
  - Local health and restart behavior are deterministic.
  - Key prefixes include environment and organization/context where applicable.
  - Permission decisions are not cached without role/user version-aware
    invalidation and conservative TTL guidance.
  - Redis unavailability/fail-safe expectations are documented before feature
    usage is introduced.
- **Verification:** Health, read/write, restart, and teardown smoke checks.
- **Estimate:** 2 points.

### P1-06 — Add pinned S3-compatible local object storage

- **Deliverable:** MinIO or equivalent Compose service, initialization job for a
  development bucket, health check, and S3 endpoint conventions.
- **Dependencies:** P1-03.
- **Acceptance criteria:**
  - Buckets are private by default; access is via server-side permission-checked
    APIs/presigned URLs, never public object URLs.
  - Local credentials exist only in ignored environment files or ephemeral CI
    configuration.
  - Object-key conventions avoid personal data and support organization scoping,
    versioning, and lifecycle operations.
  - V1 migration retains Cronberry call-recording URLs as references; this task
    does not ingest them into object storage.
- **Verification:** Health, private upload/download through an SDK smoke test,
  denied anonymous access, and teardown.
- **Estimate:** 3 points.

### P1-07 — Provide one-command local stack lifecycle

- **Deliverable:** Documented root commands for start, wait-until-healthy, stop,
  logs, and destructive reset across Postgres, Redis, and object storage.
- **Dependencies:** P1-04, P1-05, P1-06.
- **Acceptance criteria:**
  - Repeated start/stop operations are idempotent.
  - Health failures return non-zero with actionable output.
  - Service ports are configurable to avoid collisions.
  - Linux CI and developer instructions use the same Compose definition where
    practical.
- **Verification:** Automated clean-start/health/stop smoke script.
- **Estimate:** 2 points.

## Sprint 2 — Continuous integration and test foundations

### P1-08 — Implement pull-request CI quality gates

- **Deliverable:** CI workflow with dependency caching and independent jobs for
  install integrity, formatting, lint, typecheck, unit/integration tests, and
  build.
- **Dependencies:** P1-01, P1-02, P1-07.
- **Acceptance criteria:**
  - Lockfile-frozen installs are mandatory.
  - Jobs have explicit timeouts, minimal permissions, concurrency cancellation,
    and no long-lived cloud secrets.
  - Postgres integration tests use a real ephemeral database.
  - Required checks map directly to root commands and fail the PR independently.
  - Build artifacts/test reports are retained only as needed and contain no
    secrets or personal data.
- **Verification:** Successful run plus controlled failing-branch evidence for
  lint, type, test, and build gates.
- **Estimate:** 5 points.

### P1-09 — Create the database/integration-test harness

- **Deliverable:** Reusable Testcontainers-based Postgres harness, fixture
  factories, isolation/reset strategy, and migration smoke-test contract.
- **Dependencies:** P1-04, P1-08.
- **Acceptance criteria:**
  - Tests run against real PostgreSQL with deterministic parallel isolation.
  - Fixtures are synthetic and organization-scoped; no production data.
  - The harness can apply migrations from empty state and verify rollback where
    supported or documented restoration where rollback is unsafe.
  - Hooks exist for permission-matrix, import, and audit-log assertions without
    implementing those features yet.
- **Verification:** Parallel integration smoke suite and empty-to-latest schema
  test once the first migration exists.
- **Estimate:** 5 points.

### P1-10 — Establish contract, E2E, and accessibility test shells

- **Deliverable:** Tooling and minimal health-page smoke paths for API contracts,
  Playwright browser tests, and automated accessibility checks.
- **Dependencies:** P1-01, P1-08.
- **Acceptance criteria:**
  - No fake authorization behavior is presented as production enforcement.
  - Future role-lifecycle scenarios (representative seller user, manager, admin)
    have documented fixture interfaces without hardcoded role-name decisions.
  - Browser diagnostics are retained on failure.
  - Tests run headlessly in CI.
- **Verification:** Minimal smoke/contract/accessibility jobs pass.
- **Estimate:** 3 points.

### P1-11 — Build synthetic scale and load-test foundations

- **Deliverable:** Deterministic synthetic-data generator contract and load-test
  harness configuration for 200,000 Leads and 100 concurrent authenticated
  users.
- **Dependencies:** P1-09.
- **Acceptance criteria:**
  - Generator produces configurable organizations, hierarchy depth, process
    instances, assignments, statuses, and custom-field distributions without
    Wellsure personal data or fixed seed-name logic.
  - Scenarios cover indexed Seller List/search, permission-filtered list/count
    parity, normal writes, and a resumable 100,000-row import once endpoints
    exist.
  - Thresholds are encoded: list/search p95 <2s, normal write p95 <1s, 100 users
    without error-rate degradation, and import not blocking interactive use.
  - CI runs only a cheap smoke profile; scheduled/manual environments run the
    acceptance profile.
- **Verification:** Generator determinism/volume unit tests and load-tool smoke
  run against a stub health target; no claim of product performance yet.
- **Estimate:** 5 points.

## Sprint 2 — Terraform baseline

### P1-12 — Scaffold Terraform structure and conventions

- **Deliverable:** `infra/terraform` layout for reusable modules and environment
  roots, with version constraints, formatting/validation, naming/tagging, and
  variable/output conventions.
- **Dependencies:** Architecture's AWS deployment direction; independent of
  ADR-0005 except that no identity-provider resource is created.
- **Acceptance criteria:**
  - Separate environment roots and reusable module boundaries are documented.
  - Provider/Terraform versions are constrained.
  - Remote-state backend/bootstrap is documented separately to avoid a circular
    dependency; state and plan artifacts are treated as sensitive.
  - No credentials, account IDs, real domains, or production values are
    committed.
  - Placeholder module boundaries cover network, compute, PostgreSQL, Redis,
    object storage, observability, and backup concerns without provisioning
    production resources in this task.
  - Auth-provider resources are explicitly deferred to ADR-0005.
- **Verification:** `terraform fmt -check`, `terraform init -backend=false`, and
  `terraform validate` for each root using safe example variables.
- **Estimate:** 5 points.

### P1-13 — Add Terraform CI and policy/security checks

- **Deliverable:** Changed-directory Terraform formatting/validation and a pinned
  infrastructure security/static-analysis check.
- **Dependencies:** P1-12, P1-08.
- **Acceptance criteria:**
  - CI requires no AWS credentials for formatting/static validation.
  - Apply is never run on pull requests.
  - Plans, when later enabled, require protected environments and human review.
  - Tool selection and any new dependency are justified in the PR.
- **Verification:** Passing baseline plus a controlled invalid-configuration
  failure demonstration.
- **Estimate:** 3 points.

## Sprint 2 — Operational readiness baseline

### P1-14 — Document foundation operations and recovery assumptions

- **Deliverable:** Update operations documentation with local troubleshooting,
  ownership, observability interfaces, backup/restore responsibilities, and a
  future drill checklist.
- **Dependencies:** P1-07, P1-12.
- **Acceptance criteria:**
  - Distinguish local reset from production recovery.
  - Define expected logs/metrics/traces without logging credentials, sensitive
    fields, or personal data.
  - Identify RPO/RTO as decisions to obtain before production infrastructure.
  - Provide a testable restore-drill skeleton; do not claim a drill passed before
    infrastructure exists.
- **Verification:** Human runbook walkthrough and link check.
- **Estimate:** 2 points.

## Recommended sequence and exit criteria

1. Complete P1-01 through P1-03.
2. Run P1-04, P1-05, and P1-06 in parallel; integrate them in P1-07.
3. Complete P1-08, then build test foundations P1-09 through P1-11.
4. Build P1-12 and P1-13 without waiting for ADR-0005.
5. Finish P1-14 and run a clean-clone foundation review.

Phase 1 exits when a new developer can clone the repository, start all local
services, run every root quality command, execute real-Postgres smoke tests, and
validate the non-provisioning Terraform roots using documented commands. CI must
enforce the same checks. No CRM feature, permission decision, audit behavior, or
performance target is considered implemented merely because its test harness or
backlog hook exists.

## Explicitly out of scope

- Authentication-provider selection or auth/session implementation.
- CRM API routes, UI workflows, worker jobs, migration execution, or seed data.
- Production AWS provisioning or Terraform apply automation.
- Hardcoded Journey, Status, Field, Role, Service, Department, Designation, or
  assignment-type names.
- Claims that the quality-gate performance thresholds pass before representative
  endpoints and datasets exist.
