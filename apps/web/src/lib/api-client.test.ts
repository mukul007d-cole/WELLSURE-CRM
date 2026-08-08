import { describe, expect, it } from 'vitest';

import { ORGANIZATION_ID } from '../mocks/fixtures';
import { authApi, configApi, sellersApi } from './api-client';

async function signIn() {
  await authApi.login(ORGANIZATION_ID, 'admin@wellsure.com', 'Wellsure@123');
}

describe('api client with the test-only MSW server', () => {
  it('logs in and lists sellers through fetch', async () => {
    await expect(
      authApi.login(ORGANIZATION_ID, 'admin@wellsure.com', 'Wellsure@123'),
    ).resolves.toHaveProperty('userId');
    const result = await sellersApi.list({ page: 1, pageSize: 10 });
    expect(result.total).toBeGreaterThan(0);
    expect(result.rows.length).toBeGreaterThan(0);
  });

  /**
   * These three guard the config transport. Each one silently returned nothing
   * before — an empty journey list and an empty field list render as a working
   * page, so only an explicit assertion catches it.
   */
  it('unwraps the journey Page envelope instead of resolving to nothing', async () => {
    await signIn();
    const journeys = await configApi.journeys();
    expect(journeys.length).toBeGreaterThan(0);
    expect(typeof journeys[0]?.id).toBe('string');
    expect(typeof journeys[0]?.name).toBe('string');
  });

  it('reads statuses off the journey document, ordered by sortOrder and normalized', async () => {
    await signIn();
    const [journey] = await configApi.journeys();
    const statuses = await configApi.statuses(journey!.id);

    expect(statuses.length).toBeGreaterThan(0);
    // The API serializes `active`; consumers rely on `isActive`.
    expect(statuses.every((status) => typeof status.isActive === 'boolean')).toBe(true);
    expect(statuses.map((status) => status.sortOrder)).toEqual(
      [...statuses.map((status) => status.sortOrder)].sort((a, b) => a - b),
    );
  });

  it('maps API field rows onto the domain field shape', async () => {
    await signIn();
    const fields = await configApi.fields();

    expect(fields.length).toBeGreaterThan(0);
    // `name`/`fieldType` on the wire, `label`/`type` in the app.
    expect(fields.every((field) => typeof field.label === 'string' && field.label.length > 0)).toBe(
      true,
    );
    expect(fields.every((field) => typeof field.type === 'string')).toBe(true);
    expect(fields.find((field) => field.options !== undefined)?.options?.length).toBeGreaterThan(0);
  });
});
