import { describe, expect, it } from 'vitest';

import { ORGANIZATION_ID } from '../mocks/fixtures';
import { authApi, sellersApi } from './api-client';

describe('api client with the test-only MSW server', () => {
  it('logs in and lists sellers through fetch', async () => {
    await expect(
      authApi.login(ORGANIZATION_ID, 'admin@wellsure.com', 'Wellsure@123'),
    ).resolves.toHaveProperty('userId');
    const result = await sellersApi.list({ page: 1, pageSize: 10 });
    expect(result.total).toBeGreaterThan(0);
    expect(result.rows.length).toBeGreaterThan(0);
  });
});
