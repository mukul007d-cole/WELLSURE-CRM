import pino from 'pino';

import { parseWorkerEnv } from './config.js';
import { pollDrain } from './drain.js';
import { startPollLoop } from './loop.js';

const config = parseWorkerEnv(process.env);
const logger = pino({ level: config.logLevel });

logger.info(
  { apiInternalUrl: config.apiInternalUrl, pollIntervalMs: config.pollIntervalMs },
  'campaign delivery worker starting',
);

const loop = startPollLoop({
  intervalMs: config.pollIntervalMs,
  poll: () => pollDrain(config),
  onResult: (result) => {
    if (result.organizations > 0) logger.info(result, 'drain complete');
    else logger.debug(result, 'drain complete, nothing pending');
  },
  // A failed poll (the API is down, mid-deploy, or briefly unreachable) is
  // logged and the loop keeps going — the next tick tries again. There is
  // no backlog to lose: the pending rows this poll would have drained stay
  // exactly where they are in Postgres until a later poll succeeds.
  onError: (error) => logger.error({ err: error }, 'drain poll failed'),
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'graceful shutdown started');
  await loop.stop();
  logger.info('graceful shutdown complete');
  process.exitCode = 0;
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
