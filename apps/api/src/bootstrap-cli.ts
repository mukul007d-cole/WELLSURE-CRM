import { pathToFileURL } from 'node:url';
import type { FalconPrismaClient } from '@falcon/database';
import { withheldFromBootstrapPairs } from '@falcon/permission-engine';

import { bootstrapFirstAdmin } from './admin/bootstrap.js';
import type { AuthConfig } from './auth/config.js';
import type { EmailSender } from './auth/password-reset.js';
import { createRuntime } from './runtime.js';

export interface BootstrapOptions {
  organizationName: string;
  adminName: string;
  adminEmail: string;
}

interface BootstrapDependencies {
  prisma: FalconPrismaClient;
  emailSender: EmailSender;
  authConfig: AuthConfig;
}

function required(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

export function parseBootstrapOptions(argv: string[], env: NodeJS.ProcessEnv): BootstrapOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined || value.startsWith('--'))
      throw new Error(`Expected --organization-name, --admin-name, and --admin-email arguments`);
    values.set(flag, value);
  }
  return {
    organizationName: required(
      values.get('--organization-name') ?? env.FALCON_BOOTSTRAP_ORGANIZATION_NAME,
      'organization name',
    ),
    adminName: required(
      values.get('--admin-name') ?? env.FALCON_BOOTSTRAP_ADMIN_NAME,
      'administrator name',
    ),
    adminEmail: required(
      values.get('--admin-email') ?? env.FALCON_BOOTSTRAP_ADMIN_EMAIL,
      'administrator email',
    ),
  };
}

export async function runBootstrap(
  options: BootstrapOptions,
  dependencies: BootstrapDependencies,
): Promise<{ organizationId: string; userId: string }> {
  const organization = await dependencies.prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtext('falcon:first-run-bootstrap'))",
    );
    const [organizationCount, userCount] = await Promise.all([
      transaction.organization.count(),
      transaction.user.count(),
    ]);
    if (organizationCount !== 0 || userCount !== 0) {
      throw new Error(
        `Bootstrap refused: the database already contains ${organizationCount} organization(s) and ${userCount} user(s).`,
      );
    }
    return transaction.organization.create({
      data: { name: required(options.organizationName, 'organization name') },
    });
  });
  const { user } = await bootstrapFirstAdmin({
    ...dependencies,
    organizationId: organization.id,
    name: options.adminName,
    email: options.adminEmail,
  });
  return { organizationId: organization.id, userId: user.id };
}

async function main(): Promise<void> {
  const runtime = createRuntime(process.env);
  try {
    const options = parseBootstrapOptions(process.argv.slice(2), process.env);
    const result = await runBootstrap(options, runtime);
    console.log(`Bootstrap complete for organization ${result.organizationId}.`);
    console.log(
      `The initial administrator (${options.adminEmail.toLowerCase()}) must use the password-reset email just sent to set their password.`,
    );
    const withheld = withheldFromBootstrapPairs();
    if (withheld.length > 0) {
      // Otherwise the first 403 on a purge route looks like a bug rather than
      // the deliberate decision it is (ADR-0017).
      console.log(
        `\nNot granted, deliberately: ${withheld.join(', ')}.\n` +
          'Purge permanently deletes configuration and cannot be undone, so it is granted to a role\n' +
          'on purpose rather than by default — the grant itself is recorded in system_audit_logs.\n' +
          'Grant it under Roles & Permissions when it is genuinely needed.',
      );
    }
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
