import type { WorkerConfig } from './config.js';

export interface DrainResult {
  organizations: number;
  sent: number;
  failed: number;
  skippedNoEmail: number;
}

export class DrainRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * One poll: calls the API's internal drain route and returns its summary.
 * Carries no database credentials of its own — the API process does the
 * actual work through the same `CampaignSendService` the manual-send route
 * uses, so there is exactly one implementation of "how a pending campaign
 * send gets delivered", not a second one duplicated into this process.
 */
export async function pollDrain(
  config: Pick<WorkerConfig, 'apiInternalUrl' | 'internalWorkerToken'>,
  fetchImpl: typeof fetch = fetch,
): Promise<DrainResult> {
  const url = new URL('/api/v1/internal/campaigns/drain', config.apiInternalUrl);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.internalWorkerToken}` },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new DrainRequestError(
      response.status,
      `drain request failed: ${response.status} ${body}`,
    );
  }
  return (await response.json()) as DrainResult;
}
