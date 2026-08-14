import { createHash } from 'node:crypto';

import type { RecordPredicate } from '@falcon/permission-engine';
import { columnFillRate, columnSamples, parseCsv, type CsvTable } from '@falcon/validation';

import { isLeadError } from '../leads/errors.js';
import { LeadService, type LeadRepository } from '../leads/service.js';
import { DryRunRollback, ImportError, isDryRunRollback, isImportError } from './errors.js';
import {
  coerceCell,
  resolveStatusByLabel,
  validateMapping,
  type ImportFieldDefinition,
  type ImportStatusDefinition,
  type ResolvedMapping,
} from './mapping.js';
import { buildDuplicateQuery, type MatchValue } from './matching.js';
import type { ImportAnalysis, ImportMapping, ImportRunResult, RowOutcome } from './types.js';

/**
 * A file is bounded, and the whole run is one transaction.
 *
 * Those two facts are the same fact. Rows have to see each other's inserts —
 * otherwise a preview reports "create, create" where the commit reports
 * "create, skip" for two rows that duplicate each other — and partial success
 * needs savepoints, which need an enclosing transaction. A transaction held
 * open for the file's duration is the price, and the cap is what keeps that
 * price bounded. Matches `maxManualRecipients` in `routes/campaigns.ts`.
 */
export const maxImportRows = 5000;
export const maxImportBytes = 5 * 1024 * 1024;
/** Generous, because the ceiling is `maxImportRows` savepointed creations. */
const transactionTimeoutMs = 120_000;
const transactionMaxWaitMs = 15_000;

export interface ImportRepository {
  /** Active Fields assigned to the Journey and not `hidden` there. */
  listImportableFields(organizationId: string, journeyId: string): Promise<ImportFieldDefinition[]>;
  listActiveStatuses(organizationId: string, journeyId: string): Promise<ImportStatusDefinition[]>;
  /** Lowercased email → user id, for the users named in assignment columns. */
  findUserIdsByEmail(
    organizationId: string,
    emails: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
  userExists(organizationId: string, userId: string): Promise<boolean>;
  findJourneyName(organizationId: string, journeyId: string): Promise<string | null>;
}

/** The subset of the transaction client this module drives directly. */
export interface ImportTransactionClient {
  $executeRawUnsafe(text: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T>(text: string, ...values: unknown[]): Promise<T>;
  importJob: { create(args: unknown): Promise<{ id: string }> };
  importJobRow: { createMany(args: unknown): Promise<unknown> };
  systemAuditLog: { create(args: unknown): Promise<unknown> };
}

export interface ImportPrismaClient {
  $transaction<T>(
    work: (tx: ImportTransactionClient) => Promise<T>,
    options?: { timeout?: number; maxWait?: number },
  ): Promise<T>;
}

export interface LeadRepositoryFactory {
  forTransaction(tx: never): LeadRepository;
}

/** Bytes → the identity a commit is checked against. */
export function hashContent(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

export interface ImportRunInput {
  organizationId: string;
  actorUserId: string;
  mode: 'preview' | 'commit';
  fileName: string;
  content: string;
  mapping: ImportMapping;
  /** Roll the whole file back if any row is rejected. Off by default (§D2). */
  stopOnError?: boolean;
  /** The importer's `leads:view` predicate — decides which matches may be named. */
  recordPredicate: RecordPredicate;
  /** Echoed from the preview. A mismatch is refused rather than committed. */
  expectedContentHash?: string | undefined;
}

export class ImportService {
  constructor(
    private readonly prisma: ImportPrismaClient,
    private readonly repository: ImportRepository,
    private readonly leadRepositoryFactory: LeadRepositoryFactory,
    private readonly visibleLeadIds: (
      tx: ImportTransactionClient,
      input: { organizationId: string; predicate: RecordPredicate; leadIds: readonly string[] },
    ) => Promise<ReadonlySet<string>>,
  ) {}

  /** Step one: what is in this file? Reads nothing but the file. */
  analyze(input: { fileName: string; content: string }): ImportAnalysis {
    const table = readFile(input.content);
    return {
      fileName: input.fileName,
      contentHash: hashContent(input.content),
      rowCount: table.rows.length,
      raggedRowNumbers: table.raggedRowNumbers,
      columns: table.header.map((name, index) => ({
        index,
        name,
        samples: columnSamples(table, index, 3),
        fillRate: columnFillRate(table, index),
      })),
    };
  }

  /**
   * Steps two and three, which are the same step.
   *
   * `mode` changes exactly one thing: whether the transaction commits. Every
   * row runs the real `LeadService.createLead`, against the real repository,
   * writing real activity and reaching the real trigger consumers — and then a
   * preview throws `DryRunRollback` and Postgres undoes all of it. There is no
   * second, simplified validation path that could disagree with this one,
   * because there is no second path at all.
   */
  async run(input: ImportRunInput): Promise<ImportRunResult> {
    const contentHash = hashContent(input.content);
    if (input.expectedContentHash !== undefined && input.expectedContentHash !== contentHash) {
      throw new ImportError(
        'conflict',
        'the file has changed since it was previewed; preview it again',
        { expected: input.expectedContentHash, actual: contentHash },
      );
    }
    const table = readFile(input.content);
    const [fields, statuses] = await Promise.all([
      this.repository.listImportableFields(input.organizationId, input.mapping.journeyId),
      this.repository.listActiveStatuses(input.organizationId, input.mapping.journeyId),
    ]);
    const mapping = validateMapping(input.mapping, { header: table.header, fields, statuses });

    // Whole-file assignment users, checked once. `createLead` checks them too;
    // doing it here turns one misconfigured user from five thousand identical
    // row rejections into one comprehensible message about the file.
    for (const assignment of mapping.fileAssignments) {
      if (!(await this.repository.userExists(input.organizationId, assignment.userId))) {
        throw new ImportError('validation_error', 'assignment user is invalid', {
          userId: assignment.userId,
        });
      }
    }

    // Every email any assignment column names, resolved in one query rather than
    // one per row.
    const emails = new Set<string>();
    for (const row of table.rows) {
      for (const column of mapping.assignmentColumns) {
        const value = row.cells[column.index]?.trim().toLowerCase() ?? '';
        if (value !== '') emails.add(value);
      }
    }
    const usersByEmail = await this.repository.findUserIdsByEmail(input.organizationId, [
      ...emails,
    ]);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const leadRepository = this.leadRepositoryFactory.forTransaction(tx as never);
          const leadService = new LeadService(leadRepository);
          const outcomes: RowOutcome[] = [];
          const matchedLeadIds = new Set<string>();
          // Per-run, never on the instance: the service is constructed once and
          // shared, so remembering matched names on `this` would both leak and
          // let one import's matches surface in another's response.
          const matchNames = new Map<string, string>();

          for (const row of table.rows) {
            await tx.$executeRawUnsafe(`SAVEPOINT import_row`);
            try {
              const outcome = await this.processRow({
                tx,
                leadService,
                organizationId: input.organizationId,
                actorUserId: input.actorUserId,
                mapping,
                statuses,
                usersByEmail,
                matchNames,
                rowNumber: row.rowNumber,
                cells: row.cells,
              });
              await tx.$executeRawUnsafe(`RELEASE SAVEPOINT import_row`);
              if (outcome.outcome === 'skipped_duplicate' && outcome.matchedLeadId !== null) {
                matchedLeadIds.add(outcome.matchedLeadId);
              }
              outcomes.push(outcome);
            } catch (error) {
              // Only a row's own verdict is a row outcome. A database fault is
              // not: it propagates, and the whole file rolls back.
              if (!isImportError(error) && !isLeadError(error)) throw error;
              await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT import_row`);
              outcomes.push({
                rowNumber: row.rowNumber,
                outcome: 'rejected',
                code: error.code,
                reason: error.message,
              });
            }
          }

          // One scoped query, through the Seller List's own predicate, deciding
          // which matches this importer may be told the identity of.
          const visible = await this.visibleLeadIds(tx, {
            organizationId: input.organizationId,
            predicate: input.recordPredicate,
            leadIds: [...matchedLeadIds],
          });

          const counts = {
            rowCount: table.rows.length,
            createdCount: outcomes.filter((row) => row.outcome === 'created').length,
            skippedCount: outcomes.filter((row) => row.outcome === 'skipped_duplicate').length,
            rejectedCount: outcomes.filter((row) => row.outcome === 'rejected').length,
          };

          const jobId = await this.writeJob(tx, {
            organizationId: input.organizationId,
            actorUserId: input.actorUserId,
            fileName: input.fileName,
            contentHash,
            mapping: input.mapping,
            status: input.mode === 'commit' ? 'committed' : 'preview',
            counts,
            outcomes,
          });

          const result: ImportRunResult = {
            ...counts,
            mode: input.mode,
            committed: input.mode === 'commit',
            jobId,
            fileName: input.fileName,
            contentHash,
            rows: outcomes.map((outcome) => redactMatch(outcome, visible, matchNames)),
          };

          // A preview always rolls back. A commit rolls back too when
          // `stopOnError` is set and anything was rejected — which is why the
          // admin still gets the *whole* error list rather than only the first
          // failure: every row is evaluated, and then nothing is kept.
          if (
            input.mode === 'preview' ||
            (input.stopOnError === true && counts.rejectedCount > 0)
          ) {
            throw new DryRunRollback<ImportRunResult>({
              ...result,
              committed: false,
              jobId: null,
            });
          }
          return result;
        },
        { timeout: transactionTimeoutMs, maxWait: transactionMaxWaitMs },
      );
    } catch (error) {
      if (isDryRunRollback<ImportRunResult>(error)) return error.payload;
      throw error;
    }
  }

  private async processRow(input: {
    tx: ImportTransactionClient;
    leadService: LeadService;
    organizationId: string;
    actorUserId: string;
    mapping: ResolvedMapping;
    statuses: readonly ImportStatusDefinition[];
    usersByEmail: ReadonlyMap<string, string>;
    /** Names of matched leads, collected here and redacted after the loop. */
    matchNames: Map<string, string>;
    rowNumber: number;
    cells: readonly string[];
  }): Promise<RowOutcome> {
    const { mapping, cells } = input;
    const cell = (index: number | null): string =>
      index === null ? '' : (cells[index]?.trim() ?? '');

    const fieldValues: Record<string, unknown> = {};
    const matchValues: MatchValue[] = [];
    for (const column of mapping.fieldColumns) {
      const value = coerceCell(column.fieldType, cells[column.index] ?? '');
      // A blank cell writes nothing, so an unmapped-in-this-row Field keeps
      // whatever `validateFieldValues` decides about requiredness.
      if (value !== undefined) fieldValues[column.fieldId] = value;
    }
    for (const key of mapping.matchKeys) {
      matchValues.push({
        key,
        value:
          key.kind === 'core' ? cell(key.index) : coerceCell(key.fieldType, cells[key.index] ?? ''),
      });
    }

    // Before creating anything: is this row already a lead?
    const query = buildDuplicateQuery(input.organizationId, matchValues);
    if (query !== null) {
      const matches = await input.tx.$queryRawUnsafe<{ id: string; name: string }[]>(
        query.text,
        ...query.values,
      );
      const match = matches[0];
      if (match !== undefined) {
        input.matchNames.set(match.id, match.name);
        return {
          rowNumber: input.rowNumber,
          outcome: 'skipped_duplicate',
          matchedLeadId: match.id,
          matchedLeadName: match.name,
        };
      }
    }

    let statusId = mapping.statusId;
    if (mapping.statusColumnIndex !== null) {
      const label = cell(mapping.statusColumnIndex);
      if (label !== '') {
        const status = resolveStatusByLabel(input.statuses, label);
        if (status === null) {
          throw new ImportError(
            'validation_error',
            'no status in this journey matches that value',
            {
              value: label,
            },
          );
        }
        statusId = status.id;
      }
    }

    const assignments = [...mapping.fileAssignments];
    for (const column of mapping.assignmentColumns) {
      const email = cell(column.index).toLowerCase();
      if (email === '') continue;
      const userId = input.usersByEmail.get(email);
      if (userId === undefined) {
        // Never silently fall back to the importer or to any default owner —
        // that is the rule `docs/api/endpoints.md` states for single-lead
        // creation, and bulk does not get an exemption from it.
        throw new ImportError('validation_error', 'no user matches that assignment email', {
          email,
        });
      }
      assignments.push({ assignmentType: column.assignmentType, userId });
    }

    const phone = cell(mapping.phoneIndex);
    const email = cell(mapping.emailIndex);
    const created = await input.leadService.createLead({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      journeyId: mapping.journeyId,
      ...(statusId === undefined ? {} : { statusId }),
      name: cell(mapping.nameIndex),
      ...(mapping.phoneIndex === null ? {} : { phone: phone === '' ? null : phone }),
      ...(mapping.emailIndex === null ? {} : { email: email === '' ? null : email }),
      fieldValues,
      assignments,
    });
    return {
      rowNumber: input.rowNumber,
      outcome: 'created',
      leadId: created.lead.id,
      processInstanceId: created.process.id,
    };
  }

  /**
   * The run's audit trail.
   *
   * Written on every run, including a preview — whose transaction then discards
   * it. Keeping the write unconditional is what makes preview and commit the
   * same code path rather than nearly the same one.
   *
   * The stored row keeps the true `matched_lead_id` even where the response
   * redacts it: the audit trail records what happened, and the response
   * respects the reader's scope. Those are different questions.
   */
  private async writeJob(
    tx: ImportTransactionClient,
    input: {
      organizationId: string;
      actorUserId: string;
      fileName: string;
      contentHash: string;
      mapping: ImportMapping;
      status: string;
      counts: {
        rowCount: number;
        createdCount: number;
        skippedCount: number;
        rejectedCount: number;
      };
      outcomes: readonly RowOutcome[];
    },
  ): Promise<string> {
    const job = await tx.importJob.create({
      data: {
        organizationId: input.organizationId,
        source: 'csv_upload',
        fileKey: input.contentHash,
        fileName: input.fileName,
        status: input.status,
        mappingJson: input.mapping as unknown as Record<string, unknown>,
        rowCount: input.counts.rowCount,
        createdCount: input.counts.createdCount,
        skippedCount: input.counts.skippedCount,
        rejectedCount: input.counts.rejectedCount,
        createdById: input.actorUserId,
      },
      select: { id: true },
    });
    if (input.outcomes.length > 0) {
      await tx.importJobRow.createMany({
        data: input.outcomes.map((outcome) => ({
          organizationId: input.organizationId,
          importJobId: job.id,
          rowNumber: outcome.rowNumber,
          outcome: outcome.outcome,
          ...(outcome.outcome === 'created'
            ? { leadId: outcome.leadId, processInstanceId: outcome.processInstanceId }
            : {}),
          ...(outcome.outcome === 'skipped_duplicate'
            ? { matchedLeadId: outcome.matchedLeadId }
            : {}),
          ...(outcome.outcome === 'rejected'
            ? { reason: `${outcome.code}: ${outcome.reason}` }
            : {}),
        })),
      });
    }
    /*
     * The bulk action itself, in `system_audit_logs`.
     *
     * Each created lead already writes its own `activity_logs` row through the
     * ordinary creation path, which is the per-record trail. This is the
     * per-*run* one `docs/permissions/access-model.md` requires of a bulk
     * action, and it carries the counts so an auditor never has to reconstruct
     * them by counting leads.
     */
    await tx.systemAuditLog.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        entityType: 'import_job',
        entityId: job.id,
        action: input.status === 'committed' ? 'import_commit' : 'import_preview',
        oldValue: undefined,
        newValue: {
          fileName: input.fileName,
          contentHash: input.contentHash,
          journeyId: input.mapping.journeyId,
          ...input.counts,
        },
      },
    });
    return job.id;
  }
}

/** The file, read once, with this feature's limits applied. */
function readFile(content: string): CsvTable & { raggedRowNumbers: readonly number[] } {
  if (Buffer.byteLength(content, 'utf8') > maxImportBytes) {
    throw new ImportError('payload_too_large', 'the file is larger than the import limit', {
      maxBytes: maxImportBytes,
    });
  }
  return parseCsv(content, { maxRows: maxImportRows });
}

/**
 * Report a duplicate without disclosing a record the importer cannot see.
 *
 * The match itself is always reported — suppressing it would silently create a
 * duplicate — but the matched lead is named only when it is inside the
 * importer's own Seller List predicate.
 */
function redactMatch(
  outcome: RowOutcome,
  visible: ReadonlySet<string>,
  names: ReadonlyMap<string, string>,
): RowOutcome {
  if (outcome.outcome !== 'skipped_duplicate' || outcome.matchedLeadId === null) return outcome;
  if (visible.has(outcome.matchedLeadId)) {
    return {
      ...outcome,
      matchedLeadName: names.get(outcome.matchedLeadId) ?? outcome.matchedLeadName,
    };
  }
  return { ...outcome, matchedLeadId: null, matchedLeadName: null };
}
