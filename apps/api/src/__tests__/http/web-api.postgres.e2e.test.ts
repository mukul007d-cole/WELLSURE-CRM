/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await, @typescript-eslint/no-unnecessary-type-assertion */
import { hashPassword } from '../../auth/password.js';
import { defaultAuthConfig } from '../../auth/config.js';
import { buildServer } from '../../http/build-server.js';
import type { ServerDependencies } from '../../http/types.js';
import {
  createPostgresAuthRepository,
  createPostgresDatabase,
  seedUser,
  setupAuthSchema,
  shouldRunPostgresIntegration,
} from '../fixtures/synthetic-auth.js';
import { afterAll, describe, expect, it } from 'vitest';

let cleanup: (() => Promise<void>) | undefined;
afterAll(async () => cleanup?.());

describe.runIf(shouldRunPostgresIntegration)(
  'web api-client through Fastify and real Postgres',
  () => {
    it('round-trips login, session cookie, and Seller List without MSW', async () => {
      const database = await createPostgresDatabase();
      cleanup = database.cleanup;
      await setupAuthSchema(database.sql);
      await database.sql`CREATE TEMP TABLE transport_test_leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, name text NOT NULL)`;
      const organizationId = '11111111-1111-1111-1111-111111111111';
      const email = 'transport-user@example.test';
      const password = 'Synthetic-password-123!';
      const userId = await seedUser(database.sql, {
        organizationId,
        email,
        passwordHash: await hashPassword(password),
      });
      const [user] = await database.sql<
        { role_id: string }[]
      >`SELECT role_id FROM auth_test_users WHERE id = ${userId}`;
      const [lead] = await database.sql<
        { id: string }[]
      >`INSERT INTO transport_test_leads (organization_id, name) VALUES (${organizationId}, 'Synthetic Transport Seller') RETURNING id`;
      const authRepository = createPostgresAuthRepository(database.sql);
      const permissionRepository = {
        async getUser() {
          return {
            id: userId,
            organizationId,
            roleId: user!.role_id,
            active: true,
            departmentId: null,
            managerId: null,
          };
        },
        async getRole() {
          return { id: user!.role_id, organizationId, active: true, version: 1 };
        },
        async getRolePermission() {
          return { module: 'leads', action: 'view', scope: 'ORGANIZATION' };
        },
        async listAccessibleJourneyIds() {
          return [];
        },
        async listFieldVisibility() {
          return [];
        },
        async hasJourneyAccess() {
          return true;
        },
        async getLeadScope() {
          return null;
        },
        async listAssignments() {
          return [];
        },
        async getDirectGrant() {
          return null;
        },
        async listReportUserIds() {
          return [];
        },
        async listDepartmentUserIds() {
          return [];
        },
      };
      const leadRepository = {
        async listSellers() {
          const rows = await database.sql<
            { id: string; name: string }[]
          >`SELECT id, name FROM transport_test_leads WHERE organization_id = ${organizationId}`;
          return {
            total: rows.length,
            rows: rows.map((row) => ({
              id: row.id,
              name: row.name,
              phone: null,
              email: null,
              fieldValues: {},
              processInstances: [],
            })),
          };
        },
      };
      const server = buildServer({
        authRepository,
        audit: authRepository,
        permissionRepository,
        leadRepository,
        configurationRepository: {},
        emailSender: { async sendPasswordReset() {} },
        authConfig: { ...defaultAuthConfig, secureCookies: false },
        corsOrigins: ['http://localhost:5173'],
        logLevel: 'silent',
      } as unknown as ServerDependencies);
      await server.listen({ host: '127.0.0.1', port: 0 });
      const address = server.server.address();
      if (address === null || typeof address === 'string')
        throw new Error('Fastify did not open a TCP port');
      const base = `http://127.0.0.1:${address.port}`;
      const nativeFetch = globalThis.fetch;
      let cookie = '';
      globalThis.fetch = async (input, init) => {
        const url = typeof input === 'string' && input.startsWith('/') ? `${base}${input}` : input;
        const headers = new Headers(init?.headers);
        if (cookie) headers.set('cookie', cookie);
        const response = await nativeFetch(url, { ...init, headers });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';', 1)[0] ?? '';
        return response;
      };
      try {
        const clientUrl = new URL('../../../../web/src/lib/api-client.ts', import.meta.url).href;
        const { authApi, sellersApi } = (await import(clientUrl)) as any;
        await expect(authApi.login(organizationId, email, password)).resolves.toEqual({ userId });
        expect(cookie).toMatch(/^falcon_session=/);
        await expect(sellersApi.list({ page: 1, pageSize: 10 })).resolves.toEqual({
          total: 1,
          rows: [expect.objectContaining({ id: lead!.id, name: 'Synthetic Transport Seller' })],
        });
      } finally {
        globalThis.fetch = nativeFetch;
        await server.close();
      }
    });
  },
);
