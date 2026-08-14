import type { RecordPredicate } from '@falcon/permission-engine';
import type { FalconPrismaClient } from '@falcon/database';

import { buildSellerListQuery } from '../leads/filter-sql.js';
import type { ImportFieldDefinition, ImportStatusDefinition } from './mapping.js';
import type { ImportRepository, ImportTransactionClient } from './service.js';

export class PrismaImportRepository implements ImportRepository {
  constructor(private readonly prisma: FalconPrismaClient) {}

  /**
   * What a column may be mapped to.
   *
   * Three conditions, all of which `validateFieldValues` would otherwise
   * enforce one row at a time: the Field is active, it is actively assigned to
   * this Journey, and the assignment is not `hidden`. Excluding them here is
   * what turns "field is not assigned to this journey" from five thousand row
   * rejections into a mapping target that was never offered.
   *
   * This feature never creates a Field, so anything absent from this list is
   * simply not mappable.
   */
  async listImportableFields(
    organizationId: string,
    journeyId: string,
  ): Promise<ImportFieldDefinition[]> {
    const settings = await this.prisma.fieldJourneySetting.findMany({
      where: {
        organizationId,
        journeyId,
        active: true,
        requirement: { not: 'hidden' },
        field: { active: true },
      },
      include: { field: { select: { id: true, key: true, name: true, fieldType: true } } },
    });
    return settings.map((setting) => ({
      id: setting.field.id,
      key: setting.field.key,
      name: setting.field.name,
      fieldType: setting.field.fieldType,
    }));
  }

  async listActiveStatuses(
    organizationId: string,
    journeyId: string,
  ): Promise<ImportStatusDefinition[]> {
    return this.prisma.status.findMany({
      where: { organizationId, journeyId, active: true },
      select: { id: true, key: true, name: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findUserIdsByEmail(
    organizationId: string,
    emails: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    if (emails.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      // Only active users. An assignment column naming someone who has left
      // rejects the row rather than assigning a lead to a deactivated account.
      where: { organizationId, active: true, email: { in: [...emails], mode: 'insensitive' } },
      select: { id: true, email: true },
    });
    return new Map(users.map((user) => [user.email.toLowerCase(), user.id]));
  }

  async userExists(organizationId: string, userId: string): Promise<boolean> {
    const row = await this.prisma.user.findUnique({
      where: { organizationId_id: { organizationId, id: userId } },
      select: { id: true },
    });
    return row !== null;
  }

  async findJourneyName(organizationId: string, journeyId: string): Promise<string | null> {
    const row = await this.prisma.journey.findUnique({
      where: { organizationId_id: { organizationId, id: journeyId } },
      select: { name: true },
    });
    return row?.name ?? null;
  }
}

/**
 * Which of these leads may this caller be told about?
 *
 * Answered by the Seller List's own compiled predicate with an id restriction
 * added, not by a second scoping rule. Duplicate matching runs organization-wide
 * on purpose — a matcher blind to records the importer cannot see would create
 * real duplicates — so this is what keeps the *reporting* inside their scope.
 */
export async function visibleLeadIds(
  tx: ImportTransactionClient,
  input: { organizationId: string; predicate: RecordPredicate; leadIds: readonly string[] },
): Promise<ReadonlySet<string>> {
  if (input.leadIds.length === 0) return new Set();
  const query = buildSellerListQuery({
    organizationId: input.organizationId,
    predicate: input.predicate,
    conditions: [],
    leadIds: input.leadIds,
    page: 1,
    pageSize: input.leadIds.length,
  });
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(query.ids.text, ...query.ids.values);
  return new Set(rows.map((row) => row.id));
}
