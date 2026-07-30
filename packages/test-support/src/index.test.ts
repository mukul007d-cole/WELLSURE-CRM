import { describe, expect, it } from 'vitest';

import { workspaceName } from './index.js';

describe('workspace foundation', () => {
  it('exports its stable package name', () => {
    expect(workspaceName).toMatch(/^@falcon\//);
  });
});
