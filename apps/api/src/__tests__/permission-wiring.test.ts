/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it } from 'vitest';

import { authenticateCookie } from '../auth/middleware.js';
import { defaultAuthConfig } from '../auth/config.js';
import { issueSession, type SessionRepository, type SessionRecord } from '../auth/session.js';
import { getSeller360, type SellerReadRepository, type Seller360Record } from '../routes/leads.js';
import type { PermissionRepository, UserSnapshot } from '@falcon/permission-engine';

const now = new Date('2026-01-01T00:00:00.000Z');
const orgA = 'org-a';
const journeyA = 'journey-a';
const leadA = 'lead-a';

describe('session to permission engine route wiring', () => {
  it('authorizes a lead read, strips denied fields, rejects revoked sessions, and blocks cross-org data', async () => {
    const sessions = new MemorySessionRepository();
    const issued = await issueSession({
      repository: sessions,
      config: defaultAuthConfig,
      userId: 'user-child',
      organizationId: orgA,
      now,
    });
    const auth = await authenticateCookie({
      repository: sessions,
      config: defaultAuthConfig,
      cookieHeader: `${defaultAuthConfig.sessionCookieName}=${issued.token}`,
      now,
    });
    expect(auth).not.toBeNull();

    const sellerRepository = new MemorySellerRepository();
    const response = await getSeller360({
      auth: auth!,
      leadId: leadA,
      sellerRepository,
      permissionRepository: createPermissionRepository(),
      requestedFieldIds: ['field-visible', 'field-hidden'],
      assignmentTypes: [],
      now,
    });

    expect(response).toEqual({
      status: 200,
      body: {
        id: leadA,
        name: 'Synthetic Lead',
        phone: null,
        email: 'seller@example.test',
        fieldValues: { 'field-visible': 'visible' },
        processInstances: [
          {
            processInstanceId: 'process-a',
            organizationId: orgA,
            leadId: leadA,
            journeyId: journeyA,
            currentStatusId: 'status-a',
            isPrimary: true,
            active: true,
            journey: { id: journeyA, key: 'journey-a', name: 'Journey A' },
            currentStatus: {
              id: 'status-a',
              key: 'status-a',
              name: 'Status A',
              outcomeType: 'open',
              behaviorType: 'default',
            },
            assignments: [
              {
                id: 'assignment-a',
                organizationId: orgA,
                processInstanceId: 'process-a',
                assignmentType: 'synthetic_assignment_type',
                userId: 'user-child',
                isCurrent: true,
                userName: 'Synthetic Child',
              },
            ],
          },
        ],
      },
    });

    await sessions.revokeSession(issued.record.id, orgA, now);
    await expect(
      authenticateCookie({
        repository: sessions,
        config: defaultAuthConfig,
        cookieHeader: `${defaultAuthConfig.sessionCookieName}=${issued.token}`,
        now,
      }),
    ).resolves.toBeNull();

    const crossOrg = await getSeller360({
      auth: { ...auth!, user: { ...auth!.user, organizationId: 'org-b' } },
      leadId: leadA,
      sellerRepository,
      permissionRepository: createPermissionRepository(),
      requestedFieldIds: ['field-visible'],
      assignmentTypes: [],
      now,
    });
    expect(crossOrg.status).toBe(404);
  });
});

class MemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, SessionRecord>();
  async createSession(input: Omit<SessionRecord, 'id'>): Promise<SessionRecord> {
    const row = { ...input, id: `session-${this.sessions.size + 1}` };
    this.sessions.set(row.tokenHash, row);
    return row;
  }
  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return this.sessions.get(tokenHash) ?? null;
  }
  async touchSession(): Promise<void> {}
  async revokeSession(
    sessionId: string,
    organizationId: string,
    at: Date,
  ): Promise<SessionRecord | null> {
    const row = [...this.sessions.values()].find(
      (session) => session.id === sessionId && session.organizationId === organizationId,
    );
    if (row === undefined) return null;
    row.revokedAt = at;
    return row;
  }
  async getUserSnapshot(userId: string, organizationId: string): Promise<UserSnapshot | null> {
    return userId === 'user-child' && organizationId === orgA
      ? {
          id: userId,
          organizationId,
          roleId: 'role-self',
          active: true,
          departmentId: null,
          managerId: null,
        }
      : null;
  }
}

class MemorySellerRepository implements SellerReadRepository {
  async findSeller360(organizationId: string, leadId: string): Promise<Seller360Record | null> {
    if (organizationId !== orgA || leadId !== leadA) return null;
    return {
      id: leadA,
      organizationId,
      name: 'Synthetic Lead',
      phone: null,
      email: 'seller@example.test',
      fieldValues: { 'field-visible': 'visible', 'field-hidden': 'hidden' },
      processInstances: [
        {
          id: 'process-a',
          organizationId,
          leadId,
          journeyId: journeyA,
          currentStatusId: 'status-a',
          isPrimary: true,
          active: true,
          journey: { id: journeyA, key: 'journey-a', name: 'Journey A' },
          currentStatus: {
            id: 'status-a',
            key: 'status-a',
            name: 'Status A',
            outcomeType: 'open',
            behaviorType: 'default',
          },
          assignments: [
            {
              id: 'assignment-a',
              organizationId,
              processInstanceId: 'process-a',
              assignmentType: 'synthetic_assignment_type',
              userId: 'user-child',
              isCurrent: true,
              userName: 'Synthetic Child',
            },
          ],
        },
      ],
    };
  }
  // Not exercised by `getSeller360`/`resolveLeadAccess` — this test only
  // needs `findSeller360`, but `SellerReadRepository` is one interface.
  async listFilterableFieldTypes(): Promise<ReadonlyMap<string, string>> {
    return new Map();
  }
  async listMatchingLeadIds(): Promise<string[]> {
    return [];
  }
  async listSellers(): Promise<{ rows: []; total: number }> {
    return { rows: [], total: 0 };
  }
}

function createPermissionRepository(): PermissionRepository {
  return {
    async getUser(userId, organizationId) {
      return userId === 'user-child' && organizationId === orgA
        ? {
            id: userId,
            organizationId,
            roleId: 'role-self',
            active: true,
            departmentId: null,
            managerId: null,
          }
        : null;
    },
    async getRole(roleId, organizationId) {
      return roleId === 'role-self' && organizationId === orgA
        ? { id: roleId, organizationId, active: true, version: 1 }
        : null;
    },
    async getRolePermission() {
      return { module: 'leads', action: 'view', scope: 'SELF' };
    },
    async hasJourneyAccess() {
      return true;
    },
    async hasActiveRoutingRule() {
      return false;
    },
    async hasStatusVisibilityBypass() {
      return false;
    },
    async listAccessibleJourneyIds() {
      return [journeyA];
    },
    async getFieldVisibility() {
      return [{ fieldId: 'field-visible', accessLevel: 'VIEW' }];
    },
    async getLeadScope() {
      return null;
    },
    async listActiveUserIds() {
      return ['user-child'];
    },
    async listDepartmentUserIds() {
      return ['user-child'];
    },
    async listReports() {
      return [];
    },
    async listCurrentAssignments() {
      return [
        {
          leadId: leadA,
          processInstanceId: 'process-a',
          assignmentType: 'synthetic_assignment_type',
          userId: 'user-child',
          organizationId: orgA,
          isCurrent: true,
          journeyId: journeyA,
        },
      ];
    },
    async getActiveDirectGrant() {
      return null;
    },
  };
}
