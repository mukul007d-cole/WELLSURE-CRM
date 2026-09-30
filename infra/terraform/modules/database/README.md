# database module

One RDS PostgreSQL instance, private and encrypted, with its subnet group and a
Terraform-generated master password. The connection URL it outputs is what the
`secrets` module publishes as `FALCON_DATABASE_URL`.

Operating procedures (migrations, the cost teardown, restoring) live in
`docs/operations/deployment.md`. This file describes the module's interface.

## Inputs

| Input | Default | What it does |
| --- | --- | --- |
| `project_name`, `environment`, `common_tags` | — | Naming and tagging. The instance identifier is `<project_name>-<environment>`. |
| `private_subnet_ids` | — | Subnets for the DB subnet group. RDS requires at least two AZs, and the module refuses fewer. |
| `database_security_group_id` | — | The group that admits PostgreSQL traffic from the API only. |
| `engine_version` | `17.5` | Matches `docker-compose.yml` and the Testcontainers suites, so local, CI and deployed agree on the major version. |
| `instance_class` | `db.t4g.micro` | |
| `allocated_storage` | `20` | GiB. Autoscales to four times this. |
| `backup_retention_days` | `7` | Must be at least 1: point-in-time restore is the documented rollback path. |
| `deletion_protection` | `true` | Refuse to delete the instance until this is turned off. |
| `snapshot_identifier` | `null` | Restore the instance from this RDS snapshot instead of creating an empty database. |

### `snapshot_identifier`

Null creates an empty database, which is what a new environment wants. Set to a
snapshot identifier, the instance is created by restoring that snapshot. This is
how an environment comes back after its database was destroyed, whether for
cost or recovery. Staging passes it through as `db_snapshot_identifier`, and
production will want the same wiring.

The snapshot this module usually restores from is its own. Destroy always takes
a final snapshot (`skip_final_snapshot = false`), named `<name_prefix>-final`:
`falcon-crm-staging-final` for staging.

Three properties of the provider's handling matter here:

- **Only change it while the instance does not exist.** The attribute forces
  replacement. A new value against a live instance plans a destroy followed by a
  restore. Leaving it set after a restore, or setting it back to `null`, plans
  no change, because the provider keeps the value it restored from.
- **The restored instance gets this module's password, not the snapshot's.**
  RDS restores a snapshot with the master password it was taken with, and the
  AWS provider then immediately sets the configured `password` on it with a
  `ModifyDBInstance`. So whatever `random_password.master` holds at restore time
  is what the database and the connection URL agree on. This holds even when
  the old password is long gone from state, which is always the case after a
  targeted destroy of this module.
- **The final snapshot's name is fixed.** A second destroy fails to take its
  final snapshot while `<name_prefix>-final` from the previous one still exists.
  Once a restored environment is verified, delete that snapshot, or copy it
  under a dated name and then delete it.

### `deletion_protection`

The default is `true`, and production should keep it. Staging passes `false` on
purpose. The original design made destroying staging awkward deliberately, but
idle staging costs about $60 a month, most of it this instance and the NAT
gateway. The cost teardown destroys this module to stop paying for it. That is
a considered reversal of the original design, not an oversight. The final
snapshot is what keeps it safe.

## Outputs

| Output | What it is |
| --- | --- |
| `name_prefix` | `<project_name>-<environment>`. |
| `endpoint` | `host:port` of the instance. Not reachable from outside the VPC. |
| `connection_url` | Sensitive. The full `FALCON_DATABASE_URL`, including the generated password and `sslmode=no-verify`. |

### Why the URL ends `sslmode=no-verify`

RDS PostgreSQL 17's default parameter group sets `rds.force_ssl = 1`, so the
server refuses any connection that is not TLS. Prisma's migration engine
negotiates TLS on its own, so migrations worked without this. The application
connects through `@prisma/adapter-pg` (node-postgres), which sends plaintext
unless the URL asks otherwise. The server refused it, and Prisma reported:

```
User was denied access on the database
```

That reads like a credentials problem, and it is not one.

`no-verify` encrypts the connection without validating the server's
certificate against the RDS CA. `require` is not the lighter option it is in
libpq: node-postgres treats `prefer`, `require` and `verify-ca` as aliases for
`verify-full`, which fails without the RDS CA bundle. Inside a private VPC, for
staging, `no-verify` is an acceptable trade. **Production wants the RDS CA
bundle in the image and `sslmode=verify-full`.** This output currently hardcodes
`no-verify` for every environment, so that is a change to make here before
production is applied.

## State

The master password is generated here rather than supplied as a variable, so it
never exists in a tfvars file, a shell history or a pull request. It does exist
in Terraform state, which is why `infra/terraform/README.md` requires the state
backend to be encrypted, versioned and access-controlled.
