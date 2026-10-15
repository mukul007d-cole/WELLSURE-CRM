import { randomUUID } from 'node:crypto';

import type { FalconPrismaClient } from '@falcon/database';

import { nameLookupKey, resolveUserByName, type Resolved } from './apply-config.js';
import type { CutoverConfig } from './config.js';
import {
  gstKey,
  nameKey,
  normalizeEmail,
  normalizeFieldValue,
  normalizePhone,
  parseRemarks,
  parseSourceDateTime,
  phoneKey,
} from './normalize.js';
import {
  emptyFileReport,
  noteDroppedValue,
  type CutoverReport,
  type FileReport,
} from './report.js';
import type { SourceRow } from './sources.js';

type Tx = FalconPrismaClient;

export interface SourceFile {
  journeyKey: string;
  path: string;
  headers: string[];
  rows: SourceRow[];
}

/** One source record, normalized, before it is written. */
interface Candidate {
  file: FileReport;
  journeyKey: string;
  externalId: string;
  externalRef: string;
  statusId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  phoneKey: string | null;
  nameKey: string | null;
  gstKey: string | null;
  fieldValues: Record<string, unknown>;
  ownerUserId: string;
  previousOwnerUserId: string | null;
  createdAt: Date | null;
  followUpAt: Date | null;
  remarks: string | undefined;
}

/**
 * Migrates every export file inside the caller's transaction. Records already
 * carrying a `process_instances.external_ref` are skipped, so a re-run is a
 * no-op for them (ADR-0027 §4).
 */
export async function migrateLeads(input: {
  tx: Tx;
  organizationId: string;
  actorUserId: string;
  config: CutoverConfig;
  resolved: Resolved;
  files: readonly SourceFile[];
  report: CutoverReport;
}): Promise<void> {
  const { tx, organizationId, config, resolved, report } = input;
  const columns = config.columns;
  const offset = config.sourceUtcOffset;
  const fieldsByColumn = new Map(
    config.fields
      .filter((field) => field.sourceColumn !== undefined)
      .map((field) => [field.sourceColumn!, field]),
  );
  const coreColumns = new Set(
    [
      columns.externalId,
      columns.name,
      columns.phone,
      columns.email,
      columns.status,
      columns.owner,
      columns.previousOwner,
      columns.createdAt,
      columns.followUpAt,
      columns.remarks,
    ].filter((column): column is string => column !== undefined),
  );

  const owners = new OwnerResolver(tx, organizationId, input.actorUserId, config, resolved, report);
  const candidates: Candidate[] = [];
  for (const source of input.files) {
    const file = emptyFileReport(source.journeyKey, source.path);
    report.files.push(file);
    file.ignoredColumns = source.headers.filter(
      (header) => !coreColumns.has(header) && !fieldsByColumn.has(header),
    );
    const externalIds = source.rows.map((row) => row[columns.externalId] ?? '');
    const existing = new Set(
      (
        await tx.processInstance.findMany({
          where: {
            organizationId,
            externalRef: {
              in: externalIds.filter((id) => id !== '').map((id) => `${config.source}:${id}`),
            },
          },
          select: { externalRef: true },
        })
      ).map((row) => row.externalRef),
    );
    for (const row of source.rows) {
      file.source += 1;
      const externalId = row[columns.externalId] ?? '';
      if (externalId === '') {
        file.rejected.push({ externalId: '(blank)', reason: 'no external id' });
        continue;
      }
      const externalRef = `${config.source}:${externalId}`;
      if (existing.has(externalRef)) {
        file.alreadyMigrated += 1;
        continue;
      }
      const statusText = row[columns.status] ?? '';
      const statusId = resolved.statusIdBySpelling.get(
        `${source.journeyKey}:${nameLookupKey(statusText)}`,
      );
      if (statusId === undefined) {
        file.unmappedStatuses[statusText] = (file.unmappedStatuses[statusText] ?? 0) + 1;
        file.rejected.push({ externalId, reason: `status "${statusText}" is not mapped` });
        continue;
      }
      const statusKey = resolved.statusById.get(statusId)!.key;
      file.statusCounts[statusKey] = (file.statusCounts[statusKey] ?? 0) + 1;
      const ownerName = row[columns.owner] ?? '';
      if (ownerName === '') {
        file.rejected.push({ externalId, reason: 'no owner' });
        continue;
      }
      const ownerUserId = await owners.resolve(ownerName);
      let previousOwnerUserId: string | null = null;
      const previousName =
        columns.previousOwner === undefined ? '' : (row[columns.previousOwner] ?? '');
      if (previousName !== '') {
        previousOwnerUserId = resolveUserByName(resolved, previousName);
        if (previousOwnerUserId === null) file.previousOwners.unresolved += 1;
        else file.previousOwners.assigned += 1;
      }

      const fieldValues: Record<string, unknown> = {};
      for (const [column, value] of Object.entries(row)) {
        const field = fieldsByColumn.get(column);
        if (field === undefined) continue;
        const normalized = normalizeFieldValue(field, value, offset);
        if (!normalized.ok) noteDroppedValue(file, field.key, normalized.reason, value);
        else if (normalized.value !== null)
          fieldValues[resolved.fieldIdByKey.get(field.key)!] = normalized.value;
      }
      const phone = normalizePhone(row[columns.phone]);
      const email = normalizeEmail(row[columns.email]);
      const gstColumn = columns.matchColumns?.gst;
      candidates.push({
        file,
        journeyKey: source.journeyKey,
        externalId,
        externalRef,
        statusId,
        name: row[columns.name]?.trim() || null,
        phone,
        email,
        phoneKey: phoneKey(phone),
        nameKey: nameKey(row[columns.name]),
        gstKey: gstColumn === undefined ? null : gstKey(row[gstColumn]),
        fieldValues,
        ownerUserId,
        previousOwnerUserId,
        createdAt: parseSourceDateTime(
          columns.createdAt === undefined ? undefined : row[columns.createdAt],
          offset,
        ),
        followUpAt: parseSourceDateTime(
          columns.followUpAt === undefined ? undefined : row[columns.followUpAt],
          offset,
        ),
        remarks: columns.remarks === undefined ? undefined : row[columns.remarks],
      });
    }
  }

  const groups = safeMergeGroups(candidates, report);
  await writeGroups({ ...input, groups, owners });
  owners.finish();

  for (const file of report.files) {
    report.totals.source += file.source;
    report.totals.alreadyMigrated += file.alreadyMigrated;
    report.totals.rejected += file.rejected.length;
  }
}

/**
 * ADR-0027: records merge across journeys only when the phone matches **and**
 * one of name, email or GST matches, **and** the group keeps at most one
 * record per journey. Everything else stays its own lead; ambiguous cases go
 * to the review queue.
 */
function safeMergeGroups(candidates: Candidate[], report: CutoverReport): Candidate[][] {
  const parent = candidates.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]!]!;
      index = parent[index]!;
    }
    return index;
  };
  const byPhone = new Map<string, number[]>();
  candidates.forEach((candidate, index) => {
    if (candidate.phoneKey === null) return;
    const list = byPhone.get(candidate.phoneKey) ?? [];
    list.push(index);
    byPhone.set(candidate.phoneKey, list);
  });
  const sameIdentity = (a: Candidate, b: Candidate) =>
    (a.nameKey !== null && a.nameKey === b.nameKey) ||
    (a.email !== null && a.email === b.email) ||
    (a.gstKey !== null && a.gstKey === b.gstKey);
  for (const indexes of byPhone.values()) {
    if (indexes.length < 2) continue;
    const journeys = new Set(indexes.map((index) => candidates[index]!.journeyKey));
    const refs = indexes.map((index) => candidates[index]!.externalRef);
    if (journeys.size < indexes.length)
      report.merges.review.push({
        reason: 'same phone, several records in one journey',
        externalRefs: refs,
      });
    for (let i = 0; i < indexes.length; i += 1)
      for (let j = i + 1; j < indexes.length; j += 1) {
        const a = candidates[indexes[i]!]!;
        const b = candidates[indexes[j]!]!;
        if (a.journeyKey === b.journeyKey) continue;
        if (sameIdentity(a, b)) parent[find(indexes[i]!)] = find(indexes[j]!);
        else
          report.merges.review.push({
            reason: 'same phone, different identity',
            externalRefs: [a.externalRef, b.externalRef],
          });
      }
  }
  const grouped = new Map<number, Candidate[]>();
  candidates.forEach((candidate, index) => {
    const root = find(index);
    grouped.set(root, [...(grouped.get(root) ?? []), candidate]);
  });
  const groups: Candidate[][] = [];
  for (const group of grouped.values()) {
    const journeys = new Set(group.map((candidate) => candidate.journeyKey));
    if (group.length > 1 && journeys.size < group.length) {
      // A chain of matches that would put two records of one journey on one
      // lead: never merged, always reviewed.
      report.merges.review.push({
        reason: 'merge would join two records of one journey',
        externalRefs: group.map((c) => c.externalRef),
      });
      for (const candidate of group) groups.push([candidate]);
    } else groups.push(group);
  }
  return groups;
}

async function writeGroups(input: {
  tx: Tx;
  organizationId: string;
  actorUserId: string;
  config: CutoverConfig;
  resolved: Resolved;
  report: CutoverReport;
  groups: Candidate[][];
  owners: OwnerResolver;
}): Promise<void> {
  const { tx, organizationId, config, resolved, report } = input;
  const leads: Array<Record<string, unknown>> = [];
  const processes: Array<Record<string, unknown>> = [];
  const assignments: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];
  const tasks: Array<Record<string, unknown>> = [];
  const remarkSource = `migrated_${config.source}_remark`;
  const migrationSource = `migrated_${config.source}`;
  const now = new Date();

  for (const group of input.groups) {
    // Newest record first: its values win; older differing values are reported.
    const ordered = [...group].sort(
      (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
    );
    const fieldValues: Record<string, unknown> = {};
    for (const candidate of ordered)
      for (const [fieldId, value] of Object.entries(candidate.fieldValues)) {
        if (!(fieldId in fieldValues)) fieldValues[fieldId] = value;
        else if (JSON.stringify(fieldValues[fieldId]) !== JSON.stringify(value))
          report.merges.conflicts.push({
            externalRefs: group.map((c) => c.externalRef),
            field: fieldId,
            kept: ordered[0]!.externalRef,
            dropped: [candidate.externalRef],
          });
      }
    const pick = <K extends 'name' | 'phone' | 'email'>(key: K) =>
      ordered.find((candidate) => candidate[key] !== null)?.[key] ?? null;
    let name = pick('name');
    const phone = pick('phone');
    const email = pick('email');
    if (name === null) {
      name = email ?? phone ?? `Lead ${ordered[0]!.externalId}`;
      for (const candidate of group) candidate.file.namesDerived += 1;
    }
    const earliest = group
      .map((candidate) => candidate.createdAt)
      .filter((date): date is Date => date !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const leadId = randomUUID();
    leads.push({
      id: leadId,
      organizationId,
      name,
      phone,
      email,
      fieldValues,
      createdAt: earliest ?? now,
    });
    report.totals.leadsCreated += 1;
    if (group.length > 1) report.merges.crossJourneyLeads += 1;

    for (const [index, candidate] of group.entries()) {
      const processId = randomUUID();
      const createdAt = candidate.createdAt ?? now;
      processes.push({
        id: processId,
        organizationId,
        leadId,
        journeyId: resolved.journeyIdByKey.get(candidate.journeyKey)!,
        currentStatusId: candidate.statusId,
        externalRef: candidate.externalRef,
        isPrimary: index === 0,
        createdAt,
      });
      candidate.file.created += 1;
      if (index > 0) candidate.file.mergedIntoOtherJourney += 1;
      report.totals.processInstancesCreated += 1;
      if (
        candidate.previousOwnerUserId !== null &&
        candidate.previousOwnerUserId !== candidate.ownerUserId
      )
        assignments.push({
          id: randomUUID(),
          organizationId,
          processInstanceId: processId,
          assignmentType: config.assignmentTypes.previousOwner,
          userId: candidate.previousOwnerUserId,
          assignedAt: createdAt,
          isCurrent: false,
        });
      assignments.push({
        id: randomUUID(),
        organizationId,
        processInstanceId: processId,
        assignmentType: config.assignmentTypes.owner,
        userId: candidate.ownerUserId,
        assignedAt: createdAt,
        isCurrent: true,
      });
      activities.push({
        id: randomUUID(),
        organizationId,
        leadId,
        processInstanceId: processId,
        actorUserId: null,
        timestamp: createdAt,
        actionType: 'field_edit',
        source: migrationSource,
        oldValue: null,
        newValue: {
          externalRef: candidate.externalRef,
          statusId: candidate.statusId,
          fieldValues: candidate.fieldValues,
        },
      });
      for (const remark of parseRemarks(candidate.remarks, config.sourceUtcOffset)) {
        const actorUserId =
          remark.actorName === null ? null : resolveUserByName(resolved, remark.actorName);
        candidate.file.remarks.lines += 1;
        if (actorUserId !== null) candidate.file.remarks.actorsResolved += 1;
        activities.push({
          id: randomUUID(),
          organizationId,
          leadId,
          processInstanceId: processId,
          actorUserId,
          timestamp: remark.at ?? createdAt,
          actionType: 'comment',
          source: remarkSource,
          // An unresolved author keeps their name in the text, never lost.
          commentText:
            actorUserId === null && remark.actorName !== null
              ? `${remark.text} (${remark.actorName})`
              : remark.text,
          oldValue: null,
          newValue: null,
        });
      }
      if (candidate.followUpAt !== null) {
        if (resolved.statusById.get(candidate.statusId)!.outcome !== 'open')
          candidate.file.followUps.skippedClosed += 1;
        else {
          tasks.push({
            id: randomUUID(),
            organizationId,
            leadId,
            processInstanceId: processId,
            assignedToUserId: candidate.ownerUserId,
            dueDate: candidate.followUpAt,
            type: 'follow_up',
            status: 'open',
            createdFromStatusId: candidate.statusId,
            source: migrationSource,
          });
          candidate.file.followUps.created += 1;
        }
      }
    }
  }

  // Batched: thousands of rows in one transaction, without one round trip each.
  const chunks = <T>(rows: T[], size = 1000) =>
    Array.from({ length: Math.ceil(rows.length / size) }, (_, i) =>
      rows.slice(i * size, (i + 1) * size),
    );
  for (const chunk of chunks(leads)) await tx.lead.createMany({ data: chunk as never });
  for (const chunk of chunks(processes))
    await tx.processInstance.createMany({ data: chunk as never });
  for (const chunk of chunks(assignments)) await tx.assignment.createMany({ data: chunk as never });
  for (const chunk of chunks(activities)) await tx.activityLog.createMany({ data: chunk as never });
  for (const chunk of chunks(tasks)) await tx.task.createMany({ data: chunk as never });
}

/**
 * Owner names → users. An unknown former owner becomes one inactive
 * placeholder account (D3), created on first sight and reused after, so their
 * leads stay attributed and reachable by their role's managers.
 */
class OwnerResolver {
  private readonly placeholders = new Map<
    string,
    { id: string; name: string; email: string; owned: number }
  >();

  constructor(
    private readonly tx: Tx,
    private readonly organizationId: string,
    private readonly actorUserId: string,
    private readonly config: CutoverConfig,
    private readonly resolved: Resolved,
    private readonly report: CutoverReport,
  ) {}

  async resolve(name: string): Promise<string> {
    const key = nameLookupKey(name);
    const placeholder = this.placeholders.get(key);
    if (placeholder !== undefined) {
      placeholder.owned += 1;
      return placeholder.id;
    }
    const known = resolveUserByName(this.resolved, name);
    if (known !== null) return known;
    const slug = key.replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'former.owner';
    const email = `former.${slug}@${this.config.placeholderEmailDomain}`;
    const existing = await this.tx.user.findFirst({
      where: { organizationId: this.organizationId, email },
    });
    const user =
      existing ??
      (await this.tx.user.create({
        data: {
          organizationId: this.organizationId,
          name: name.replace(/\s+/g, ' ').trim(),
          email,
          roleId: this.resolved.roleIdByKey.get(this.config.placeholderRole)!,
          active: false,
          passwordHash: null,
        },
      }));
    if (existing === null)
      await this.tx.systemAuditLog.create({
        data: {
          organizationId: this.organizationId,
          actorUserId: this.actorUserId,
          entityType: 'user',
          entityId: user.id,
          action: 'cutover.placeholder_create',
          newValue: { name: user.name, email, active: false },
        },
      });
    this.resolved.placeholderUserIds.add(user.id);
    const list = this.resolved.userIdsByName.get(key) ?? [];
    list.push({ id: user.id, active: false });
    this.resolved.userIdsByName.set(key, list);
    this.placeholders.set(key, { id: user.id, name: user.name, email, owned: 1 });
    return user.id;
  }

  finish(): void {
    this.report.users.placeholders = [...this.placeholders.values()]
      .map((p) => ({ name: p.name, email: p.email, ownedRecords: p.owned }))
      .sort((a, b) => b.ownedRecords - a.ownedRecords);
  }
}
