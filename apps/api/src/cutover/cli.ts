import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import type { FalconPrismaClient } from '@falcon/database';

import { AdminService } from '../admin/service.js';
import { PrismaAdminRepository } from '../admin/prisma-admin-repository.js';
import { createRuntime } from '../runtime.js';
import { applyConfiguration } from './apply-config.js';
import { parseCutoverConfig, type CutoverConfig } from './config.js';
import { migrateLeads, type SourceFile } from './migrate-leads.js';
import { emptyReport, renderMarkdown, type CutoverReport } from './report.js';
import { parseUsersFile, readWorkbook, type SourceUser } from './sources.js';

/**
 * `pnpm --filter @falcon/api cutover -- --config <file> --users <file>
 *   --export <journeyKey>=<file.xlsx> … --actor-email <admin> [--commit]
 *   [--send-invites] [--report <path-prefix>]`
 *
 * A dry run by default: everything runs inside one transaction, the report is
 * written, and the transaction is rolled back. `--commit` keeps it. The whole
 * cutover is one transaction either way — it lands completely or not at all.
 */
export interface CutoverOptions {
  configPath: string;
  usersPath?: string;
  exports: Array<{ journeyKey: string; path: string }>;
  actorEmail: string;
  organizationId?: string;
  commit: boolean;
  sendInvites: boolean;
  reportPrefix: string;
}

export function parseCutoverArgs(argv: readonly string[]): CutoverOptions {
  const args = [...argv];
  while (args[0] === '--') args.shift();
  const options: Partial<CutoverOptions> & { exports: CutoverOptions['exports'] } = {
    exports: [],
    commit: false,
    sendInvites: false,
    reportPrefix: 'cutover-report',
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = () => {
      const next = args[index + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${flag} needs a value`);
      index += 1;
      return next;
    };
    switch (flag) {
      case '--config':
        options.configPath = value();
        break;
      case '--users':
        options.usersPath = value();
        break;
      case '--export': {
        const [journeyKey, ...rest] = value().split('=');
        if (!journeyKey || rest.length === 0) throw new Error('--export takes <journeyKey>=<file>');
        options.exports.push({ journeyKey, path: rest.join('=') });
        break;
      }
      case '--actor-email':
        options.actorEmail = value().toLowerCase();
        break;
      case '--organization-id':
        options.organizationId = value();
        break;
      case '--report':
        options.reportPrefix = value();
        break;
      case '--commit':
        options.commit = true;
        break;
      case '--send-invites':
        options.sendInvites = true;
        break;
      default:
        throw new Error(`unknown argument ${flag}`);
    }
  }
  if (options.configPath === undefined) throw new Error('--config is required');
  if (options.actorEmail === undefined)
    throw new Error('--actor-email is required: the administrator the audit trail names');
  if (options.sendInvites && !options.commit) throw new Error('--send-invites needs --commit');
  return options as CutoverOptions;
}

class DryRunRollback extends Error {}

export async function runCutover(
  options: CutoverOptions,
  prisma: FalconPrismaClient,
  loaded?: { config: CutoverConfig; users: SourceUser[]; files: SourceFile[] },
): Promise<CutoverReport> {
  const config =
    loaded?.config ?? parseCutoverConfig(JSON.parse(await readFile(options.configPath, 'utf8')));
  const users =
    loaded?.users ??
    (options.usersPath === undefined
      ? []
      : parseUsersFile(await readFile(options.usersPath, 'utf8')));
  const files: SourceFile[] = loaded?.files ?? [];
  if (loaded === undefined)
    for (const source of options.exports) {
      if (!config.journeys.some((journey) => journey.key === source.journeyKey))
        throw new Error(`--export names unknown journey "${source.journeyKey}"`);
      const { headers, rows } = await readWorkbook(source.path, config.excludedColumns);
      files.push({ journeyKey: source.journeyKey, path: source.path, headers, rows });
    }

  const organizations = await prisma.organization.findMany({ select: { id: true } });
  const organizationId =
    options.organizationId ?? (organizations.length === 1 ? organizations[0]!.id : undefined);
  if (organizationId === undefined)
    throw new Error('several organizations exist: pass --organization-id');
  const actor = await prisma.user.findFirst({
    where: { organizationId, email: options.actorEmail, active: true },
    select: { id: true },
  });
  if (actor === null) throw new Error(`no active user ${options.actorEmail} in the organization`);

  const report = emptyReport(options.commit ? 'commit' : 'dry-run', organizationId);
  try {
    await prisma.$transaction(
      async (transaction) => {
        const tx = transaction as FalconPrismaClient;
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('falcon:cutover'))");
        const resolved = await applyConfiguration({
          tx,
          organizationId,
          actorUserId: actor.id,
          config,
          users,
          report,
        });
        await migrateLeads({
          tx,
          organizationId,
          actorUserId: actor.id,
          config,
          resolved,
          files,
          report,
        });
        if (!options.commit) throw new DryRunRollback();
      },
      { timeout: 30 * 60_000, maxWait: 60_000 },
    );
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  report.finishedAt = new Date().toISOString();
  return report;
}

/** Invitations after a commit: the same reset-link flow as "Resend invite". */
async function sendInvites(
  prisma: FalconPrismaClient,
  runtime: ReturnType<typeof createRuntime>,
  organizationId: string,
  actorEmail: string,
  emails: readonly string[],
): Promise<number> {
  const actor = await prisma.user.findFirstOrThrow({
    where: { organizationId, email: actorEmail },
  });
  const service = new AdminService(
    new PrismaAdminRepository(prisma),
    runtime.emailSender,
    runtime.authConfig,
  );
  let sent = 0;
  for (const email of emails) {
    const user = await prisma.user.findFirst({
      where: { organizationId, email, active: true, passwordHash: null },
    });
    if (user === null) continue;
    await service.resendInvite({ organizationId, actorUserId: actor.id }, user.id);
    sent += 1;
  }
  return sent;
}

async function main(): Promise<void> {
  const options = parseCutoverArgs(process.argv.slice(2));
  const runtime = createRuntime(process.env);
  try {
    const report = await runCutover(options, runtime.prisma);
    await writeFile(`${options.reportPrefix}.json`, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(`${options.reportPrefix}.md`, renderMarkdown(report));
    const t = report.totals;
    console.log(
      `${report.mode}: ${t.source} records → ${t.leadsCreated} leads / ${t.processInstancesCreated} process instances; ${t.alreadyMigrated} already migrated; ${t.rejected} rejected.`,
    );
    console.log(`Report: ${options.reportPrefix}.md and .json`);
    if (options.sendInvites && options.usersPath !== undefined) {
      const users = parseUsersFile(await readFile(options.usersPath, 'utf8'));
      const sent = await sendInvites(
        runtime.prisma,
        runtime,
        report.organizationId,
        options.actorEmail,
        users.filter((user) => user.active).map((user) => user.email),
      );
      console.log(`Invitations sent: ${sent}.`);
    }
    if (!options.commit) console.log('Dry run: nothing was saved. Re-run with --commit to apply.');
  } finally {
    await runtime.prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
