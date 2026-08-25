# ADR-0018: Deployment target, email provider, and secret management

**Status:** Accepted

## Context

Sixteen phases shipped a complete CRM that had only ever run on one developer's
machine. Phase 17 was to make it reachable by real people. Investigating first
turned up four things that changed what the decision actually was.

**The Terraform provisioned nothing.** `infra/terraform` held seven modules —
`network`, `compute`, `database`, `cache`, `object-storage`, `observability`,
`backup` — and every one of them contained a `required_version` block and a
`name_prefix` local, with no `resource`, `provider`, `data` or `backend` block
anywhere in the tree. CI's `terraform validate` passed throughout, which is
exactly what it means: the HCL was internally consistent. So this was never a
choice between applying existing infrastructure code and writing new code. It was
a choice about what to write.

**The deployed system is smaller than the local one.** Redis has no reader
anywhere in the source — no client library, no queue, no `REDIS_URL` consumer.
`apps/worker` is `export const workspaceName`. Campaign delivery drains from an
authenticated HTTP route, not a scheduler. Object storage is optional by
ADR-0012. What actually has to run is one PostgreSQL, one Node process and one
static bundle.

**The frontend calls the API same-origin.** `api-client.ts` uses the relative
path `/api/v1`; in development Vite proxies it. Outside `pnpm dev` there is no
proxy, so the bundle and the API have to share an origin.

**There was no signing secret to relocate.** The phase brief listed session
cookie signing material among the secrets to move into a secret store.
`@fastify/cookie` is registered without a `secret`, and sessions are opaque
256-bit tokens stored as SHA-256 hashes and resolved by lookup. Nothing to forge,
nothing to sign.

A fifth question had no answer in the repository at all: what staging is *for*.
Nothing in `docs/` said, and the three environment roots were byte-identical
apart from a variable.

## Decision

### Staging is a long-lived evaluation environment

Wellsure logs in and evaluates the product on it before any production cutover.
It is effectively pre-production: real backups, a real domain, mail that actually
arrives, data that survives.

Rejected: a disposable smoke-test environment. It would have been cheaper and
faster, but the problem worth solving was that sixteen phases of finished product
had nowhere anyone could see it, and a smoke test does not solve that.

The consequence is that staging is not casually destroyable. The database carries
deletion protection and a final snapshot, and `terraform destroy` is deliberately
awkward.

### AWS, at minimal surface: App Runner + RDS + Secrets Manager

`v1-scope.md` and `infra/terraform/README.md` both named AWS, so staying there
means nothing written now is thrown away when production is built.

**Rejected: filling in all seven modules.** It is the option that most resembles
the existing scaffolding and least resembles what the application runs. Five of
the seven would provision things nothing consumes — `cache` would stand up an
ElastiCache instance with no reader. `cache`, `observability` and `backup` stay
interface-only stubs, each with its reason recorded in the environment root:
Redis is unread, `/health` plus CloudWatch is the minimum needed to confirm the
deployment is healthy, and RDS automated backups already cover the restore path.

**Rejected: a managed PaaS** (Fly.io, Render). Hours rather than days to a
working URL, and genuinely the right answer for a disposable environment — but
the wrong one once staging is long-lived and production is expected on AWS,
because the IaC would be written twice.

Two consequences worth stating.

**One container serves both the API and the web bundle.** The API registers
`@fastify/static` when `FALCON_WEB_ROOT` is set, with an SPA fallback that
deliberately excludes `/api` and `/health` so a mistyped API route keeps its 404
rather than returning HTML with a 200. Local development never sets the variable
and is unchanged. The alternative shapes — a reverse proxy the container would
have to supervise, or a CDN with a path behaviour to keep in step — are more
moving parts for no benefit at this size. `@fastify/static` was already in the
lockfile as a transitive dependency of `@fastify/swagger-ui`, so promoting it to
a direct dependency added three lines to `pnpm-lock.yaml` and downloaded nothing.

**A NAT gateway is unavoidable, and it is the standing cost.** App Runner egress
is all-or-nothing: the default public path has no route to a private RDS
instance, and VPC egress sends *all* outbound traffic through the VPC, so
reaching the email provider's API needs a NAT. A publicly accessible database is
not an alternative, because App Runner's default egress has no stable addresses
to restrict to.

### Resend for staging; revisit for production

Rejected for staging: **Amazon SES**, which is cheapest at volume and would use
IAM rather than an API key — and, notably, has a VPC endpoint, which would remove
the NAT gateway above. But it starts sandboxed, delivering only to verified
recipients, and leaving the sandbox is a support request that can take days. On a
phase whose entire point is getting something reachable, that is a schedule risk
with no upside yet.

Rejected for staging: **Postmark**, whose transactional deliverability is the
best of the three and which separates bulk from transactional streams by design.
That separation directly addresses the risk below, and it is the strongest
candidate for production password resets.

The choice is cheap to revisit: the provider is one branch in `createEmailSender`
implementing two methods, using the global `fetch` rather than a provider SDK, so
it adds no dependency at all.

**A risk this decision accepts:** the application sends password resets and
marketing campaigns through one transport. A high complaint rate on campaigns can
degrade deliverability of resets — marketing could stop people logging in. The
mitigation is splitting the sending subdomains (`notify.` for transactional,
`mail.` for campaigns), which is configuration rather than code, and it is the
main argument for moving transactional mail to Postmark later.

### Secrets live in the platform's store, injected as environment variables

Configuration already flows entirely through `process.env` — `main.ts` calls
`createRuntime(process.env)`, and no `dotenv` call exists in application code.
So **the minimum real change for secret management is no code change**: App
Runner resolves Secrets Manager references into environment variables at start.

The complete list of secrets is the database URL, the email API key, and the two
`S3_*` credentials if the document locker is ever enabled. There is no session
signing secret, per the Context above, and none should be invented.

The two secrets differ in kind, and the Terraform treats them differently.
Terraform *generates* the database password and writes the URL, so it is never
typed by a human or stored in a tfvars file. It *cannot* generate the email API
key, so it creates an empty secret with `ignore_changes` on the version and a
human fills it in once, out of band.

Rejected: **fetching from Secrets Manager at boot**, which supports rotation
without a redeploy. That is a real advantage, and the right upgrade when
production needs scheduled credential rotation — but it costs a new AWS SDK
dependency in the startup path and IAM handling in application code, which is not
worth it for an evaluation environment.

Rejected: **SOPS/age-encrypted files in git**. Ciphertext is not plaintext, but
it is still secrets in the repository, and rotation becomes a commit.

## Consequences

- The database master password exists in Terraform state, so the state backend
  must be encrypted and access-controlled. `backend.tf` is deliberately empty and
  configured at `init` time, per `infra/terraform/README.md`.
- Deploy order is forced by the frontend: `VITE_FALCON_ORGANIZATION_ID` is
  substituted into the bundle at build time, so the bootstrap CLI must run before
  the image is built. Getting it wrong ships a bundle that throws on load, which
  presents as a blank page and nothing else.
- Production is **not** covered by this ADR and is not ready. Its root validates,
  which means only that the HCL is consistent. What must be answered first is
  listed in `infra/terraform/environments/production/main.tf`.
- Password-setup emails link to `/reset-password`, a page that does not exist in
  `apps/web` yet. The first administrator is unaffected because the bootstrap CLI
  prints the token, but inviting real users should wait for that page. Building
  it is an application change that phase 17 held out of scope.
