# Testing & Quality Gates

## Test layers

- Unit tests: validation, status transitions, permission resolution, dedup logic
- Database/integration tests (real Postgres via Testcontainers, not mocks)
- API contract tests
- Permission-matrix tests (table-driven — every role × module × action × scope combination that matters)
- End-to-end role-based flows (Playwright): a Sales Executive, a Manager, and an Admin each doing a full lead lifecycle
- Import/migration tests against the real Cronberry sample + synthetic edge cases (duplicate fields, missing GST, malformed phone)
- Document/attachment access tests
- Accessibility checks
- Load tests (see performance targets below)
- Backup restore drill

## Performance acceptance targets

Validate against at least 200,000 synthetic seller records:

- Seller List p95 response under 2 seconds for common indexed filters
- Search p95 under 2 seconds
- Normal write action p95 under 1 second (excluding file/background work)
- Permission-filtered counts exactly match list-query results
- 100 concurrent authenticated users without error-rate degradation
- A 100,000-row import is resumable and doesn't block normal interactive use

## Definition of done (every task)

- Acceptance criteria implemented
- Tests added/updated and passing
- Type checks, lint, formatting pass
- Relevant end-to-end tests pass
- Database migration reviewed (reversible or documented rollback)
- Permission impact explicitly reviewed
- Audit logging behavior verified
- Docs updated if behavior changed
- No secrets or real personal data committed to git
- Self-review of the diff, then human review
