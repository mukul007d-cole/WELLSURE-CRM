import { describe, expect, it, vi } from 'vitest';

import { DrainRequestError, pollDrain } from './drain.js';

const config = { apiInternalUrl: 'http://localhost:3000', internalWorkerToken: 'secret-token' };

describe('pollDrain', () => {
  it('posts to the internal drain route with the bearer token, and returns the parsed result', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ organizations: 2, sent: 3, failed: 0, skippedNoEmail: 1 }),
    });

    const result = await pollDrain(config, fetchImpl);

    expect(result).toEqual({ organizations: 2, sent: 3, failed: 0, skippedNoEmail: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('http://localhost:3000/api/v1/internal/campaigns/drain');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret-token');
  });

  it('throws DrainRequestError naming the status on a non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('unauthorized'),
    });

    const error = await pollDrain(config, fetchImpl as unknown as typeof fetch).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DrainRequestError);
    expect((error as DrainRequestError).status).toBe(401);
  });
});
