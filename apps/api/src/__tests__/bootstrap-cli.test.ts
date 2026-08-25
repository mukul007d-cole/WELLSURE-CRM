import { describe, expect, it } from 'vitest';

import { parseBootstrapOptions } from '../bootstrap-cli.js';

const flags = [
  '--organization-name',
  'Wellsure Solutions',
  '--admin-name',
  'First Administrator',
  '--admin-email',
  'admin@wellsure.example',
];

const expected = {
  organizationName: 'Wellsure Solutions',
  adminName: 'First Administrator',
  adminEmail: 'admin@wellsure.example',
};

describe('parseBootstrapOptions', () => {
  it('reads the three flags', () => {
    expect(parseBootstrapOptions(flags, {})).toEqual(expected);
  });

  it('accepts the leading `--` that pnpm forwards', () => {
    /*
     * `pnpm --filter @falcon/api bootstrap -- --organization-name …` is the form
     * README and the deployment runbook both document, and pnpm passes the `--`
     * through as the first argument. Reading pairs from index 0 made `--` the
     * first flag, so the documented command failed with
     * "Expected --organization-name, --admin-name, and --admin-email arguments".
     */
    expect(parseBootstrapOptions(['--', ...flags], {})).toEqual(expected);
  });

  it('falls back to the environment variable form', () => {
    expect(
      parseBootstrapOptions([], {
        FALCON_BOOTSTRAP_ORGANIZATION_NAME: 'Wellsure Solutions',
        FALCON_BOOTSTRAP_ADMIN_NAME: 'First Administrator',
        FALCON_BOOTSTRAP_ADMIN_EMAIL: 'admin@wellsure.example',
      }),
    ).toEqual(expected);
  });

  it('still rejects a genuinely malformed invocation', () => {
    expect(() => parseBootstrapOptions(['--organization-name', '--admin-name'], {})).toThrow(
      /Expected --organization-name/,
    );
  });

  it('still requires every value', () => {
    expect(() =>
      parseBootstrapOptions(['--', '--organization-name', 'Wellsure Solutions'], {}),
    ).toThrow(/administrator name is required/);
  });
});
