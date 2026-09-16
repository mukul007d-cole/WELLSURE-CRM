import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startPollLoop } from './loop.js';

describe('startPollLoop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls immediately, then again after each interval', async () => {
    const poll = vi.fn().mockResolvedValue('ok');
    const loop = startPollLoop({ intervalMs: 1000, poll });

    await vi.waitFor(() => expect(poll).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(poll).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(poll).toHaveBeenCalledTimes(3);

    await loop.stop();
  });

  it('never overlaps: the next tick is scheduled only after the current poll resolves', async () => {
    let resolveFirst!: () => void;
    const poll = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveFirst = () => resolve('slow');
          }),
      )
      .mockResolvedValue('fast');

    const loop = startPollLoop({ intervalMs: 1000, poll });
    await vi.waitFor(() => expect(poll).toHaveBeenCalledTimes(1));

    // The interval has long since elapsed, but the first poll never
    // resolved — a plain setInterval would have fired again regardless.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(poll).toHaveBeenCalledTimes(1);

    resolveFirst();
    await vi.waitFor(() => {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(poll).toHaveBeenCalledTimes(2);

    await loop.stop();
  });

  it('reports each result and each error through the given callbacks', async () => {
    const onResult = vi.fn();
    const onError = vi.fn();
    const failure = new Error('boom');
    const poll = vi.fn().mockResolvedValueOnce('first').mockRejectedValueOnce(failure);

    const loop = startPollLoop({ intervalMs: 1000, poll, onResult, onError });
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith('first'));

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));

    await loop.stop();
  });

  it('stop() waits for an in-flight poll and schedules no further ticks', async () => {
    let resolvePoll!: () => void;
    const poll = vi.fn().mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolvePoll = () => resolve('done');
        }),
    );
    const loop = startPollLoop({ intervalMs: 1000, poll });
    await vi.waitFor(() => expect(poll).toHaveBeenCalledTimes(1));

    const stopped = loop.stop();
    resolvePoll();
    await stopped;

    await vi.advanceTimersByTimeAsync(10_000);
    expect(poll).toHaveBeenCalledTimes(1);
  });
});
