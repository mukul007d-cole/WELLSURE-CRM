import { describe, expect, it } from 'vitest';

import { parseEnv } from '../env.js';

const base = {
  FALCON_DATABASE_URL: 'postgresql://falcon:secret@localhost/falcon',
  FALCON_HTTP_PORT: '3000',
  FALCON_CORS_ORIGIN: 'http://localhost:5173',
  FALCON_LOG_LEVEL: 'info',
  FALCON_SESSION_COOKIE_SECURE: 'false',
};

const delivery = {
  FALCON_EMAIL_API_KEY: 're_test_key',
  FALCON_EMAIL_FROM: 'Falcon CRM <no-reply@notify.example.test>',
  FALCON_PUBLIC_BASE_URL: 'https://crm.example.test',
};

describe('parseEnv', () => {
  it('reports every missing variable together', () => {
    expect(() => parseEnv({})).toThrow(
      /FALCON_DATABASE_URL[\s\S]*FALCON_HTTP_PORT[\s\S]*FALCON_CORS_ORIGIN[\s\S]*FALCON_LOG_LEVEL[\s\S]*FALCON_SESSION_COOKIE_SECURE/,
    );
  });

  it('parses a valid environment', () => {
    expect(
      parseEnv({
        FALCON_DATABASE_URL: 'postgresql://falcon:secret@localhost/falcon',
        FALCON_HTTP_PORT: '3000',
        FALCON_CORS_ORIGIN: 'http://localhost:5173,https://app.example.test',
        FALCON_LOG_LEVEL: 'info',
        FALCON_SESSION_COOKIE_SECURE: 'false',
      }),
    ).toMatchObject({
      httpPort: 3000,
      emailTransport: 'console',
      sessionCookieSecure: false,
      corsOrigins: ['http://localhost:5173', 'https://app.example.test'],
    });
  });

  it('preserves an explicitly selected email transport', () => {
    expect(
      parseEnv({
        ...base,
        FALCON_EMAIL_TRANSPORT: 'smtp',
        ...delivery,
      }).emailTransport,
    ).toBe('smtp');
  });

  it('leaves delivery configuration absent for the console transport', () => {
    expect(parseEnv(base).emailDelivery).toBeUndefined();
  });

  it('does not require delivery configuration for the console transport', () => {
    // The whole point of the default: a developer who has never heard of an
    // email provider still gets a working API.
    expect(() => parseEnv(base)).not.toThrow();
  });

  it('refuses to start a real transport without the configuration it needs', () => {
    // Discovering this on the first password reset — after a user has been
    // invited and is waiting for mail that will never arrive — is far worse
    // than refusing to boot.
    expect(() => parseEnv({ ...base, FALCON_EMAIL_TRANSPORT: 'resend' })).toThrow(
      /FALCON_EMAIL_API_KEY, FALCON_EMAIL_FROM, FALCON_PUBLIC_BASE_URL/,
    );
  });

  it('names only the delivery variables that are actually missing', () => {
    expect(() =>
      parseEnv({
        ...base,
        FALCON_EMAIL_TRANSPORT: 'resend',
        FALCON_EMAIL_API_KEY: 're_key',
        FALCON_PUBLIC_BASE_URL: 'https://crm.example.test',
      }),
    ).toThrow(/needs FALCON_EMAIL_FROM$/m);
  });

  it('returns delivery configuration when a real transport is fully configured', () => {
    expect(parseEnv({ ...base, FALCON_EMAIL_TRANSPORT: 'resend', ...delivery })).toMatchObject({
      emailTransport: 'resend',
      emailDelivery: {
        apiKey: 're_test_key',
        from: 'Falcon CRM <no-reply@notify.example.test>',
        campaignFrom: 'Falcon CRM <no-reply@notify.example.test>',
        publicBaseUrl: 'https://crm.example.test',
      },
    });
  });

  it('uses a separately configured campaign sender', () => {
    expect(
      parseEnv({
        ...base,
        FALCON_EMAIL_TRANSPORT: 'resend',
        ...delivery,
        FALCON_CAMPAIGN_EMAIL_FROM: 'Falcon Campaigns <news@mail.example.test>',
      }).emailDelivery?.campaignFrom,
    ).toBe('Falcon Campaigns <news@mail.example.test>');
  });

  it('rejects a public base URL that is not a bare origin', () => {
    // A trailing path would produce `https://crm.example.test/app/reset-password`
    // in the mail, which 404s.
    expect(() =>
      parseEnv({
        ...base,
        FALCON_EMAIL_TRANSPORT: 'resend',
        ...delivery,
        FALCON_PUBLIC_BASE_URL: 'https://crm.example.test/app',
      }),
    ).toThrow(/FALCON_PUBLIC_BASE_URL must be an origin/);
  });
});
