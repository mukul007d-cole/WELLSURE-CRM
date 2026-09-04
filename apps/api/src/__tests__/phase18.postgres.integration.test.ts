import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FalconPrismaClient } from '@falcon/database';
import { PrismaAdminRepository } from '../admin/prisma-admin-repository.js';
import { defaultAuthConfig } from '../auth/config.js';
import { hashPassword } from '../auth/password.js';
import { PrismaAuthRepository } from '../auth/prisma-auth-repository.js';
import { buildServer } from '../http/build-server.js';
import { PrismaPermissionRepository } from '../permissions/prisma-permission-repository.js';
import {
  applyMigrations,
  createAdminPostgres,
  shouldRunAdminPostgres,
} from './fixtures/synthetic-admin.js';

describe.runIf(shouldRunAdminPostgres)('Phase 18 account lifecycle against real Postgres', () => {
  let db: Awaited<ReturnType<typeof createAdminPostgres>>;
  let prisma: FalconPrismaClient;
  const organizationId = randomUUID();
  const roleId = randomUUID();
  const adminId = randomUUID();
  const delivered: Array<{ to: string; token: string; expiresAt: Date }> = [];

  beforeAll(async () => {
    db = await createAdminPostgres();
    prisma = db.prisma;
    await applyMigrations(db.sql);
    await prisma.organization.create({
      data: { id: organizationId, name: 'Synthetic organization' },
    });
    await prisma.role.create({
      data: { id: roleId, organizationId, key: 'synthetic_admin', name: 'Synthetic administrator' },
    });
    await prisma.rolePermission.createMany({
      data: ['view', 'create', 'edit'].map((action) => ({
        organizationId,
        roleId,
        module: 'users',
        action,
        scope: 'ORGANIZATION' as const,
      })),
    });
    await prisma.user.create({
      data: {
        id: adminId,
        organizationId,
        roleId,
        name: 'Synthetic administrator',
        email: 'administrator@example.test',
        passwordHash: await hashPassword('Administrator-password-123!'),
      },
    });
  }, 180_000);

  afterAll(async () => db?.cleanup());

  const createServer = () => {
    const authRepository = new PrismaAuthRepository(prisma);
    return buildServer({
      authRepository,
      audit: authRepository,
      permissionRepository: new PrismaPermissionRepository(prisma as never),
      adminRepository: new PrismaAdminRepository(prisma),
      configurationRepository: {} as never,
      leadRepository: {} as never,
      emailSender: {
        sendPasswordReset(message) {
          delivered.push(message);
          return Promise.resolve();
        },
        sendEmail() {
          return Promise.resolve();
        },
      },
      authConfig: { ...defaultAuthConfig, secureCookies: false },
      corsOrigins: ['http://localhost:5173'],
      logLevel: 'silent',
    });
  };

  it('creates a user, captures the invitation, completes reset through HTTP, and logs in', async () => {
    const server = createServer();

    const adminLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        organizationId,
        email: 'administrator@example.test',
        password: 'Administrator-password-123!',
      },
    });
    expect(adminLogin.statusCode).toBe(200);
    const cookie = adminLogin.headers['set-cookie'];
    expect(cookie).toEqual(expect.any(String));

    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { cookie: String(cookie).split(';', 1)[0]! },
      payload: {
        name: 'Synthetic invited user',
        email: 'invited-user@example.test',
        roleId,
        departmentId: null,
        managerId: null,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.to).toBe('invited-user@example.test');

    const completed = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/complete',
      payload: { token: delivered[0]!.token, newPassword: 'Invited-password-123!' },
    });
    expect(completed.statusCode).toBe(204);

    const invitedLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        organizationId,
        email: 'invited-user@example.test',
        password: 'Invited-password-123!',
      },
    });
    expect(invitedLogin.statusCode).toBe(200);
    const invitedUser = await prisma.user.findFirstOrThrow({
      where: { organizationId, email: 'invited-user@example.test' },
    });
    expect(invitedUser.passwordHash).not.toBeNull();
    expect(
      await prisma.passwordResetToken.count({
        where: { organizationId, userId: invitedUser.id, usedAt: { not: null } },
      }),
    ).toBe(1);
    expect(
      await prisma.systemAuditLog.count({
        where: {
          organizationId,
          entityId: invitedUser.id,
          action: 'auth.password_reset_completed',
        },
      }),
    ).toBe(1);
    await server.close();
  }, 180_000);

  it('changes a password, keeps the current session, revokes another, and audits it', async () => {
    const server = createServer();
    const login = () =>
      server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          organizationId,
          email: 'administrator@example.test',
          password: 'Administrator-password-123!',
        },
      });
    const current = await login();
    const other = await login();
    expect(current.statusCode).toBe(200);
    expect(other.statusCode).toBe(200);
    const currentCookie = String(current.headers['set-cookie']).split(';', 1)[0]!;
    const otherCookie = String(other.headers['set-cookie']).split(';', 1)[0]!;

    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/api/v1/auth/password/change',
          payload: { currentPassword: 'Administrator-password-123!', newPassword: 'short' },
        })
      ).statusCode,
    ).toBe(401);
    const weak = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/password/change',
      headers: { cookie: currentCookie },
      payload: { currentPassword: 'Administrator-password-123!', newPassword: 'short' },
    });
    expect(weak.statusCode).toBe(400);
    expect(weak.json()).toMatchObject({ error: 'weak_password' });

    const wrong = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/password/change',
      headers: { cookie: currentCookie },
      payload: { currentPassword: 'Wrong-password-123!', newPassword: 'Changed-password-123!' },
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json()).toMatchObject({ error: 'invalid_current_password' });

    const changed = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/password/change',
      headers: { cookie: currentCookie },
      payload: {
        currentPassword: 'Administrator-password-123!',
        newPassword: 'Changed-password-123!',
      },
    });
    expect(changed.statusCode).toBe(204);
    expect(
      (
        await server.inject({
          method: 'GET',
          url: '/api/v1/auth/me',
          headers: { cookie: currentCookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await server.inject({
          method: 'GET',
          url: '/api/v1/auth/me',
          headers: { cookie: otherCookie },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      await prisma.systemAuditLog.count({
        where: { organizationId, entityId: adminId, action: 'auth.password_changed' },
      }),
    ).toBe(1);
    await server.close();
  }, 180_000);

  it('resends only passwordless-user invites, invalidates old tokens, and enforces permission', async () => {
    delivered.length = 0;
    const server = createServer();
    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        organizationId,
        email: 'administrator@example.test',
        password: 'Changed-password-123!',
      },
    });
    const cookie = String(login.headers['set-cookie']).split(';', 1)[0]!;
    const create = await server.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { cookie },
      payload: {
        name: 'Synthetic passwordless user',
        email: 'passwordless@example.test',
        roleId,
        departmentId: null,
        managerId: null,
      },
    });
    expect(create.statusCode).toBe(201);
    const passwordlessId = create.json<{ id: string }>().id;
    const oldToken = delivered.at(-1)!.token;

    await prisma.rolePermission.delete({
      where: {
        organizationId_roleId_module_action: {
          organizationId,
          roleId,
          module: 'users',
          action: 'edit',
        },
      },
    });
    expect(
      (
        await server.inject({
          method: 'POST',
          url: `/api/v1/users/${passwordlessId}/resend-invite`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(403);
    await prisma.rolePermission.create({
      data: { organizationId, roleId, module: 'users', action: 'edit', scope: 'ORGANIZATION' },
    });

    const resent = await server.inject({
      method: 'POST',
      url: `/api/v1/users/${passwordlessId}/resend-invite`,
      headers: { cookie },
    });
    expect(resent.statusCode).toBe(200);
    expect(delivered).toHaveLength(2);
    const freshToken = delivered.at(-1)!.token;
    expect(freshToken).not.toBe(oldToken);
    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/api/v1/auth/password-reset/complete',
          payload: { token: oldToken, newPassword: 'Passwordless-user-123!' },
        })
      ).json(),
    ).toMatchObject({ error: 'invalid_token' });
    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/api/v1/auth/password-reset/complete',
          payload: { token: freshToken, newPassword: 'Passwordless-user-123!' },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await server.inject({
          method: 'POST',
          url: `/api/v1/users/${passwordlessId}/resend-invite`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await server.inject({
          method: 'POST',
          url: `/api/v1/users/${randomUUID()}/resend-invite`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
    const inactive = await prisma.user.create({
      data: {
        organizationId,
        roleId,
        name: 'Synthetic inactive user',
        email: 'inactive@example.test',
        active: false,
      },
    });
    expect(
      (
        await server.inject({
          method: 'POST',
          url: `/api/v1/users/${inactive.id}/resend-invite`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      await prisma.systemAuditLog.count({
        where: { organizationId, entityId: passwordlessId, action: 'resend_invite' },
      }),
    ).toBe(1);
    await server.close();
  }, 180_000);
});
