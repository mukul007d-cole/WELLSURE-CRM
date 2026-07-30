import { describe, expect, it } from 'vitest';

import { databaseSchemaPath } from './index.js';

describe('database foundation', () => {
  it('publishes the canonical Prisma schema location', () => {
    expect(databaseSchemaPath.endsWith('schema.prisma')).toBe(true);
  });
});
