import type { FalconPrismaClient } from '@falcon/database';
import { bootstrapGrantedPairs, withheldFromBootstrapPairs } from '@falcon/permission-engine';

import type { AuthConfig } from '../auth/config.js';
import { preparePasswordReset, type EmailSender } from '../auth/password-reset.js';
import { AdminError } from './errors.js';
import { text } from './validation.js';

/** One-time, out-of-band first administrator provisioning. Never expose over HTTP. */
export async function bootstrapFirstAdmin(input: {
  prisma: FalconPrismaClient;
  emailSender: EmailSender;
  authConfig: AuthConfig;
  organizationId: string;
  name: string;
  email: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const { token: opaqueToken, tokenHash, expiresAt } = preparePasswordReset(input.authConfig, now);
  const email = text(input.email, 'email').toLowerCase();
  const result = await input.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', input.organizationId);
    if (!(await tx.organization.findUnique({ where: { id: input.organizationId } })))
      throw new AdminError('not_found', 'organization not found');
    if (await tx.user.count({ where: { organizationId: input.organizationId } }))
      throw new AdminError('conflict', 'organization has already been bootstrapped');
    const role = await tx.role.create({
      data: {
        organizationId: input.organizationId,
        key: `bootstrap_${crypto.randomUUID().replaceAll('-', '')}`,
        name: 'Initial administrator',
      },
    });
    /*
     * The catalog minus each entry's `withheldFromBootstrap` actions — today,
     * `purge` and nothing else (ADR-0017, amending ADR-0009's "complete
     * catalog"). The exclusion is decided in the catalog, not here: a second
     * place that decides which pairs exist is what made configuration
     * deactivation ungrantable for every role, and it is not coming back.
     */
    const granted = bootstrapGrantedPairs();
    await tx.rolePermission.createMany({
      data: granted.map(({ module, action }) => ({
        organizationId: input.organizationId,
        roleId: role.id,
        module,
        action,
        scope: 'ORGANIZATION' as const,
      })),
    });
    const journeys = await tx.journey.findMany({
      where: { organizationId: input.organizationId, active: true },
      select: { id: true },
    });
    if (journeys.length)
      await tx.roleJourneyAccess.createMany({
        data: journeys.map(({ id: journeyId }) => ({
          organizationId: input.organizationId,
          roleId: role.id,
          journeyId,
        })),
      });
    const fields = await tx.field.findMany({
      where: { organizationId: input.organizationId, active: true },
      select: { id: true },
    });
    if (fields.length)
      await tx.fieldVisibility.createMany({
        data: fields.map(({ id: fieldId }) => ({
          organizationId: input.organizationId,
          roleId: role.id,
          fieldId,
          accessLevel: 'EDIT' as const,
        })),
      });
    const user = await tx.user.create({
      data: {
        organizationId: input.organizationId,
        name: text(input.name, 'name'),
        email,
        roleId: role.id,
        passwordHash: null,
      },
    });
    const token = await tx.passwordResetToken.create({
      data: {
        organizationId: input.organizationId,
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });
    await tx.systemAuditLog.createMany({
      data: [
        {
          organizationId: input.organizationId,
          actorUserId: null,
          entityType: 'role',
          entityId: role.id,
          action: 'bootstrap.role_created',
          newValue: {
            permissionCount: granted.length,
            withheldPermissions: withheldFromBootstrapPairs(),
            journeyCount: journeys.length,
            fieldCount: fields.length,
          },
        },
        {
          organizationId: input.organizationId,
          actorUserId: null,
          entityType: 'user',
          entityId: user.id,
          action: 'bootstrap.user_created',
          newValue: { resetTokenId: token.id },
        },
      ],
    });
    return { user, role };
  });
  await input.emailSender.sendPasswordReset({ to: email, token: opaqueToken, expiresAt });
  return result;
}
