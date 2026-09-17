/**
 * A self-scheduling interval: the next tick is scheduled only after the
 * current one finishes, so a slow poll can never overlap with the next —
 * unlike a plain `setInterval`, which would fire on the wall clock
 * regardless of whether the previous call is still in flight.
 */
export function startPollLoop<T>(options: {
  intervalMs: number;
  poll: () => Promise<T>;
  onResult?: (result: T) => void;
  onError?: (error: unknown) => void;
}): { stop: () => Promise<void> } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: Promise<void> = Promise.resolve();

  const tick = async (): Promise<void> => {
    try {
      const result = await options.poll();
      options.onResult?.(result);
    } catch (error) {
      options.onError?.(error);
    }
    if (!stopped) {
      timer = setTimeout(() => {
        current = tick();
      }, options.intervalMs);
    }
  };

  current = tick();

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearTimeout(timer);
      // Let an in-flight poll finish rather than abandoning it mid-request.
      await current;
    },
  };
}
