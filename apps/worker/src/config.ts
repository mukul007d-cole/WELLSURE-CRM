export interface WorkerConfig {
  /** Base URL of the running API this worker polls. */
  apiInternalUrl: string;
  /** Must match the API's `FALCON_INTERNAL_WORKER_TOKEN` exactly. */
  internalWorkerToken: string;
  pollIntervalMs: number;
  logLevel: string;
}

/**
 * The worker's own environment, parsed the same way `apps/api/src/env.ts`
 * parses the API's: every problem reported together, not just the first.
 */
export function parseWorkerEnv(env: NodeJS.ProcessEnv): WorkerConfig {
  const errors: string[] = [];
  const required = (key: string): string => {
    const value = env[key]?.trim();
    if (!value) errors.push(`${key} is required`);
    return value ?? '';
  };

  const apiInternalUrl = required('FALCON_API_INTERNAL_URL');
  const internalWorkerToken = required('FALCON_INTERNAL_WORKER_TOKEN');
  const pollText = env.FALCON_WORKER_POLL_INTERVAL_MS?.trim() || '30000';
  const pollIntervalMs = Number(pollText);
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1000) {
    errors.push('FALCON_WORKER_POLL_INTERVAL_MS must be an integer of at least 1000');
  }
  const logLevel = env.FALCON_LOG_LEVEL?.trim() || 'info';
  const validLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];
  if (!validLevels.includes(logLevel)) {
    errors.push('FALCON_LOG_LEVEL must be a valid Pino level');
  }
  if (apiInternalUrl) {
    try {
      new URL(apiInternalUrl);
    } catch {
      errors.push('FALCON_API_INTERNAL_URL must be a valid URL');
    }
  }

  if (errors.length)
    throw new Error(`Invalid Falcon worker environment:\n- ${errors.join('\n- ')}`);
  return { apiInternalUrl, internalWorkerToken, pollIntervalMs, logLevel };
}
