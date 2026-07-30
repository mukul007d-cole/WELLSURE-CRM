# Terraform foundation

Terraform is organized into environment composition roots and reusable modules.
Phase 1 defines interfaces only: it provisions no AWS resources and requires no
AWS credentials. ADR-0005 remains open, so there is no identity-provider module.

Each environment passes `environment`, `project_name`, and `common_tags` to the
module boundaries. Production state will use a separately bootstrapped encrypted
remote backend with locking; backend coordinates and account-specific values must
not be committed. Pull requests run formatting and `init -backend=false` /
`validate` only. Future plans require protected environments and human review;
apply is never a pull-request action.
