# Permission Engine — Prisma Schema Review

**Status:** Phase 0 baseline for implementation in Phase 2 after ADR-0005 is
resolved where identity integration is concerned. The authorization data model
itself is provider-independent.

This is the concrete Prisma-equivalent design for the five permission-engine
tables requested by `docs/permissions/access-model.md`. It is a schema fragment:
`Organization`, `User`, `Journey`, `Field`, and `Lead` are defined by the wider
schema and are referenced here rather than duplicated. Table and column mappings
make the intended PostgreSQL names explicit.

```prisma
enum DataScope {
  SELF
  TEAM
  DEPARTMENT
  ORGANIZATION
}

enum FieldAccessLevel {
  VIEW
  EDIT
}

model Role {
  id              String   @id @default(uuid()) @db.Uuid
  organizationId  String   @map("organization_id") @db.Uuid
  key             String
  name            String
  active          Boolean  @default(true)
  version         Int      @default(1)
  isSystemDefault Boolean  @default(false) @map("is_system_default")
  createdById     String   @map("created_by") @db.Uuid
  updatedById     String   @map("updated_by") @db.Uuid
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  organization    Organization        @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  createdBy       User                @relation("RoleCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)
  updatedBy       User                @relation("RoleUpdatedBy", fields: [updatedById], references: [id], onDelete: Restrict)
  permissions     RolePermission[]
  journeyAccess   RoleJourneyAccess[]
  fieldVisibility FieldVisibility[]
  users           User[]              @relation("UserActiveRole")

  @@unique([organizationId, key])
  @@index([organizationId, active])
  @@map("roles")
}

model RolePermission {
  id             String    @id @default(uuid()) @db.Uuid
  organizationId String    @map("organization_id") @db.Uuid
  roleId         String    @map("role_id") @db.Uuid
  module         String
  action         String
  scope          DataScope
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  role         Role         @relation(fields: [roleId], references: [id], onDelete: Restrict)

  // One effective scope for each role/module/action permission.
  @@unique([organizationId, roleId, module, action])
  @@index([organizationId, module, action])
  @@map("role_permissions")
}

model RoleJourneyAccess {
  id             String   @id @default(uuid()) @db.Uuid
  organizationId String   @map("organization_id") @db.Uuid
  roleId         String   @map("role_id") @db.Uuid
  journeyId      String   @map("journey_id") @db.Uuid
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  role         Role         @relation(fields: [roleId], references: [id], onDelete: Restrict)
  journey      Journey      @relation(fields: [journeyId], references: [id], onDelete: Restrict)

  // Explicit Journey allow-list.
  @@unique([organizationId, roleId, journeyId])
  @@index([organizationId, journeyId, roleId])
  @@map("role_journey_access")
}

model FieldVisibility {
  id             String           @id @default(uuid()) @db.Uuid
  organizationId String           @map("organization_id") @db.Uuid
  fieldId        String           @map("field_id") @db.Uuid
  roleId         String           @map("role_id") @db.Uuid
  accessLevel    FieldAccessLevel @map("access_level")
  createdAt      DateTime         @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime         @updatedAt @map("updated_at") @db.Timestamptz(6)

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  field        Field        @relation(fields: [fieldId], references: [id], onDelete: Restrict)
  role         Role         @relation(fields: [roleId], references: [id], onDelete: Restrict)

  // Allow-list: absence means hidden. EDIT includes VIEW.
  @@unique([organizationId, fieldId, roleId])
  @@index([organizationId, roleId, accessLevel])
  @@map("field_visibility")
}

model UserAccessGrant {
  id              String    @id @default(uuid()) @db.Uuid
  organizationId  String    @map("organization_id") @db.Uuid
  userId          String    @map("user_id") @db.Uuid
  leadId          String    @map("lead_id") @db.Uuid
  grantedByUserId String    @map("granted_by_user_id") @db.Uuid
  expiresAt       DateTime? @map("expires_at") @db.Timestamptz(6)
  revokedAt       DateTime? @map("revoked_at") @db.Timestamptz(6)
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  organization  Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  user          User         @relation("GrantRecipient", fields: [userId], references: [id], onDelete: Restrict)
  lead          Lead         @relation(fields: [leadId], references: [id], onDelete: Restrict)
  grantedByUser User         @relation("GrantIssuer", fields: [grantedByUserId], references: [id], onDelete: Restrict)

  @@index([organizationId, userId, leadId, revokedAt, expiresAt])
  @@index([organizationId, leadId])
  @@map("user_access_grants")
}
```

## Database constraints required with the Prisma migration

Prisma cannot express every tenant and lifecycle invariant. The migration must
add these PostgreSQL constraints or triggers, remain reversible, and document
its rollback:

1. Every referenced Role, User, Journey, Field, and Lead must have the same
   `organization_id` as the permission row. Prefer composite tenant-aware
   foreign keys where the final Prisma schema permits them.
2. `roles.version >= 1`; updates that change permission configuration increment
   it transactionally.
3. A `user_access_grant` is active only when `revoked_at IS NULL AND
   (expires_at IS NULL OR expires_at > now())`. Expiry is evaluated by the API
   query, not by a cached UI decision.
4. `expires_at`, when present, must be later than `created_at`.
5. Configuration records use `ON DELETE RESTRICT`. Roles are deactivated and
   grant rows are revoked/expired; neither is hard-deleted.
6. If duplicate simultaneously active direct grants prove noisy, add a partial
   unique index for `(organization_id, user_id, lead_id)` where
   `revoked_at IS NULL`; expiry still must be checked at query time.

## Evaluation semantics

For record access, the permission engine evaluates:

```text
active user
AND feature/action permission
AND explicit Journey access
AND (role/hierarchy scope includes record OR active direct Lead grant exists)
AND requested field has an allow-list row at the required VIEW/EDIT level
AND workflow permits the action
```

A direct grant expands only the record-scope axis. It cannot grant a feature,
Journey, field, or workflow capability. `EDIT` field access implies `VIEW`;
`VIEW` does not imply `EDIT`. API serializers must omit fields without a row,
and API mutation validation must reject writes without `EDIT`.

The same resolved predicate must be shared by list, detail, count, saved-view,
bulk-operation, export, attachment, and reporting queries. The UI may reflect
these decisions but is never the enforcement boundary.

## Mutation and audit rules

- Creating, editing, deactivating, or replacing a role or any of its permission,
  Journey-access, or field-visibility rows writes a `system_audit_logs` event
  with actor and before/after values.
- Creating, revoking, or expiring a direct grant is security-relevant and writes
  a `system_audit_logs` event.
- Permission configuration changes and their audit event commit in one database
  transaction.
- Cache invalidation keys include organization, role ID/version, and user ID so
  deactivation, permission changes, and grant revocation take effect promptly.

## Required tests

Before UI work depends on this model, add table-driven tests for every relevant
module/action/scope combination, Journey allow/deny, VIEW versus EDIT, absent
field rows, hierarchy expansion, additive grants, expired/revoked grants,
cross-organization rejection, count/list parity, bulk rechecks, and export field
stripping. Use real PostgreSQL integration tests as required by
`docs/testing/quality-gates.md`.
