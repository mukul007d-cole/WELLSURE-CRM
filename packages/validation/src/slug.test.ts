import { describe, expect, it } from 'vitest';

import { nextAvailableKey, slugify } from './slug.js';

/**
 * The stricter of the two `key` shapes the schema enforces (see slug.ts's
 * header comment) — `requireConfigKey`'s and the notifications/campaigns
 * services' `^[a-z][a-z0-9_]{1,62}$`, not `configKey`'s more permissive
 * `^[a-z][a-z0-9_]*$`. Asserting against the tighter pattern here is the
 * point: it is what guards `slugify` against ever producing a single-
 * character key again, which the permissive pattern would have let through
 * silently — that gap is exactly how the bug shipped the first time.
 */
const keyPattern = /^[a-z][a-z0-9_]{1,62}$/;

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

  it('pads an all-punctuation or non-Latin name to two characters rather than one', () => {
    // A bare 'k' satisfied `configKey`'s permissive pattern but not
    // `requireConfigKey`'s (or the notifications/campaigns services') minimum
    // of two — the exact gap that let a Journey/Status/Field/Service/
    // Notification Rule/Campaign named in Devanagari, Arabic, Tamil, Bengali,
    // or CJK throw a 400 the admin could not work around.
    expect(slugify('!!!')).toBe('k0');
    expect(slugify('日本語')).toBe('k0');
    expect(slugify('नमस्ते')).toBe('k0');
  });

  it('pads a genuinely one-letter name to two characters rather than returning it bare', () => {
    expect(slugify('A')).toBe('a0');
    expect(slugify('i')).toBe('i0');
  });

  it('strips accents rather than dropping the letters that carry them', () => {
    expect(slugify('Café Journey')).toBe('cafe_journey');
  });

  it('always produces a string matching every key column’s shape', () => {
    for (const name of [
      'Ready For Onboarding',
      '123',
      '!!!',
      'Café',
      'a',
      'A',
      'A_B-C 1',
      '日本語',
      'नमस्ते',
    ]) {
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
