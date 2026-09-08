import { describe, expect, it } from 'vitest';

import { nextAvailableKey, slugify } from './slug.js';

/** The shape every `key` column in the schema enforces (see slug.ts's header comment). */
const keyPattern = /^[a-z][a-z0-9_]*$/;

describe('slugify', () => {
  it('lowercases and replaces runs of non-alphanumeric characters with one underscore', () => {
    expect(slugify('Ready For Onboarding')).toBe('ready_for_onboarding');
    expect(slugify('Sales -- Ops')).toBe('sales_ops');
    expect(slugify('  Trimmed  ')).toBe('trimmed');
  });

  it('prefixes a name that would not start with a letter', () => {
    expect(slugify('123 Leads')).toBe('k_123_leads');
    expect(slugify('42')).toBe('k_42');
  });

  it('falls back to a single-character key for an all-punctuation or non-Latin name', () => {
    expect(slugify('!!!')).toBe('k');
    expect(slugify('日本語')).toBe('k');
  });

  it('strips accents rather than dropping the letters that carry them', () => {
    expect(slugify('Café Journey')).toBe('cafe_journey');
  });

  it('always produces a string matching every key column’s shape', () => {
    for (const name of ['Ready For Onboarding', '123', '!!!', 'Café', 'a', 'A_B-C 1']) {
      expect(slugify(name)).toMatch(keyPattern);
    }
  });

  it('truncates very long names rather than producing an unbounded key', () => {
    const slug = slugify('A'.repeat(200));
    expect(slug.length).toBeLessThanOrEqual(54);
    expect(slug).toMatch(keyPattern);
  });
});

describe('nextAvailableKey', () => {
  it('returns the plain slug when it is free', async () => {
    expect(await nextAvailableKey('Ready For Onboarding', () => Promise.resolve(false))).toBe(
      'ready_for_onboarding',
    );
  });

  it('appends an underscore-numbered suffix on collision, keeping the key valid', async () => {
    const taken = new Set(['ready_for_onboarding', 'ready_for_onboarding_2']);
    const key = await nextAvailableKey('Ready For Onboarding', (candidate) =>
      Promise.resolve(taken.has(candidate)),
    );
    expect(key).toBe('ready_for_onboarding_3');
    expect(key).toMatch(keyPattern);
  });

  it('checks candidates in order rather than skipping ahead', async () => {
    const seen: string[] = [];
    await nextAvailableKey('Team', (candidate) => {
      seen.push(candidate);
      return Promise.resolve(seen.length < 3);
    });
    expect(seen).toEqual(['team', 'team_2', 'team_3']);
  });
});
