import { describe, expect, it } from 'vitest';

import { parseWorkerEnv } from './config.js';

const base = {
  FALCON_API_INTERNAL_URL: 'http://localhost:3000',
  FALCON_INTERNAL_WORKER_TOKEN: 'a-shared-secret',
};

describe('parseWorkerEnv', () => {
  it('reports every missing variable together', () => {
    expect(() => parseWorkerEnv({})).toThrow(
      /FALCON_API_INTERNAL_URL[\s\S]*FALCON_INTERNAL_WORKER_TOKEN/,
    );
  });

  it('parses a valid environment with defaults', () => {
    expect(parseWorkerEnv(base)).toEqual({
      apiInternalUrl: 'http://localhost:3000',
      internalWorkerToken: 'a-shared-secret',
      pollIntervalMs: 30_000,
      logLevel: 'info',
    });
  });

  it('honors a configured poll interval and log level', () => {
    expect(
      parseWorkerEnv({
        ...base,
        FALCON_WORKER_POLL_INTERVAL_MS: '5000',
        FALCON_LOG_LEVEL: 'debug',
      }),
    ).toMatchObject({ pollIntervalMs: 5000, logLevel: 'debug' });
  });

  it('rejects a poll interval under one second', () => {
    expect(() => parseWorkerEnv({ ...base, FALCON_WORKER_POLL_INTERVAL_MS: '500' })).toThrow(
      /FALCON_WORKER_POLL_INTERVAL_MS must be an integer of at least 1000/,
    );
  });

  it('rejects an unparseable API URL', () => {
    expect(() => parseWorkerEnv({ ...base, FALCON_API_INTERNAL_URL: 'not-a-url' })).toThrow(
      /FALCON_API_INTERNAL_URL must be a valid URL/,
    );
  });

  it('rejects an invalid log level', () => {
    expect(() => parseWorkerEnv({ ...base, FALCON_LOG_LEVEL: 'verbose' })).toThrow(
      /FALCON_LOG_LEVEL must be a valid Pino level/,
    );
  });
});
