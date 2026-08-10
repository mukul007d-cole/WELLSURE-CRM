export interface StorageEnv {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

export interface ApiEnv {
  databaseUrl: string;
  httpPort: number;
  corsOrigins: string[];
  emailTransport: string;
  logLevel: string;
  sessionCookieSecure: boolean;
  /**
   * Object storage for attachments. Optional on purpose: the API must boot
   * without a bucket, so a developer who hasn't run `pnpm infra:up` gets a
   * disabled document locker rather than a server that won't start.
   */
  storage?: StorageEnv;
}

export function parseEnv(env: NodeJS.ProcessEnv): ApiEnv {
  const errors: string[] = [];
  const required = (key: string) => {
    const value = env[key]?.trim();
    if (!value) errors.push(`${key} is required`);
    return value ?? '';
  };
  const databaseUrl = required('FALCON_DATABASE_URL');
  const portText = required('FALCON_HTTP_PORT');
  const originText = required('FALCON_CORS_ORIGIN');
  const emailTransport = env.FALCON_EMAIL_TRANSPORT?.trim() || 'console';
  const logLevel = required('FALCON_LOG_LEVEL');
  const secureText = required('FALCON_SESSION_COOKIE_SECURE');
  const httpPort = Number(portText);
  if (portText && (!Number.isInteger(httpPort) || httpPort < 1 || httpPort > 65_535)) {
    errors.push('FALCON_HTTP_PORT must be an integer from 1 to 65535');
  }
  const corsOrigins = originText
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const origin of corsOrigins) {
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error();
    } catch {
      errors.push(`FALCON_CORS_ORIGIN contains an invalid origin: ${origin}`);
    }
  }
  if (!['true', 'false'].includes(secureText)) {
    errors.push('FALCON_SESSION_COOKIE_SECURE must be true or false');
  }
  if (!['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(logLevel)) {
    errors.push('FALCON_LOG_LEVEL must be a valid Pino log level');
  }
  try {
    const url = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error();
  } catch {
    if (databaseUrl) errors.push('FALCON_DATABASE_URL must be a PostgreSQL URL');
  }
  // All five or none — a half-configured bucket fails at upload time with a
  // credentials error, which is a worse signal than "not configured".
  const storageKeys = ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'];
  const storageValues = storageKeys.map((key) => env[key]?.trim() ?? '');
  const storageConfigured = storageValues.every((value) => value !== '');
  if (!storageConfigured && storageValues.some((value) => value !== '')) {
    errors.push(`Object storage needs all of ${storageKeys.join(', ')} or none of them`);
  }

  if (errors.length) throw new Error(`Invalid Falcon API environment:\n- ${errors.join('\n- ')}`);
  return {
    databaseUrl,
    httpPort,
    corsOrigins,
    emailTransport,
    logLevel,
    sessionCookieSecure: secureText === 'true',
    ...(storageConfigured
      ? {
          storage: {
            endpoint: storageValues[0]!,
            region: storageValues[1]!,
            bucket: storageValues[2]!,
            accessKey: storageValues[3]!,
            secretKey: storageValues[4]!,
          },
        }
      : {}),
  };
}
