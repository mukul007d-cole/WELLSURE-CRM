/*
 * Remote state, configured at init time rather than committed.
 *
 * `infra/terraform/README.md` requires a separately bootstrapped encrypted
 * backend with locking, and requires that backend coordinates and
 * account-specific values stay out of git. So this block is deliberately empty:
 * the bucket, key, region and lock table are supplied by
 * `terraform init -backend-config=…`, which is what
 * `docs/operations/deployment.md` documents.
 *
 * State matters more here than usual. The database module generates the master
 * password, so the state file contains a live credential — which is why the
 * backend must be encrypted and access-controlled, and why the password is
 * never written to a tfvars file.
 *
 * CI runs `init -backend=false` and `validate` only, and never sees these
 * coordinates.
 */
terraform {
  backend "s3" {}
}
