import { describe, expect, it } from 'vitest';

import { parseEnv } from '../env.js';

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
      sessionCookieSecure: false,
      corsOrigins: ['http://localhost:5173', 'https://app.example.test'],
    });
  });
});
