export interface StorageEnv {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

export interface EmailDeliveryEnv {
  apiKey: string;
  /** Verified sender, e.g. `Falcon CRM <no-reply@notify.example.com>`. */
  from: string;
  /** Public origin of the deployed web app, no trailing slash. */
  publicBaseUrl: string;
}

export interface ApiEnv {
  databaseUrl: string;
  httpPort: number;
  corsOrigins: string[];
  emailTransport: string;
  logLevel: string;
  sessionCookieSecure: boolean;
  /**
   * Present exactly when `emailTransport` is not `console`. A real transport
   * cannot work without all three, and finding that out on the first password
   * reset — after a user has been invited — is far worse than refusing to boot.
   */
  emailDelivery?: EmailDeliveryEnv;
  /**
   * Object storage for attachments. Optional on purpose: the API must boot
   * without a bucket, so a developer who hasn't run `pnpm infra:up` gets a
   * disabled document locker rather than a server that won't start.
   */
  storage?: StorageEnv;
  /**
   * Directory holding the built web bundle, served same-origin with the API.
   * Set only in a deployed environment; locally Vite serves the app and proxies
   * `/api` here, so setting it would shadow the dev server for no reason.
   */
  webRoot?: string;
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
  // A real transport needs a key, a verified sender, and somewhere for the reset
  // link to point. The console transport needs none of them, so this is required
  // only once one is selected — local development is unaffected.
  const deliveryKeys = ['FALCON_EMAIL_API_KEY', 'FALCON_EMAIL_FROM', 'FALCON_PUBLIC_BASE_URL'];
  const deliveryValues = deliveryKeys.map((key) => env[key]?.trim() ?? '');
  const deliveryConfigured = deliveryValues.every((value) => value !== '');
  if (emailTransport !== 'console') {
    const missing = deliveryKeys.filter((_, index) => deliveryValues[index] === '');
    if (missing.length) {
      errors.push(`FALCON_EMAIL_TRANSPORT="${emailTransport}" also needs ${missing.join(', ')}`);
    }
  }
  const publicBaseUrl = deliveryValues[2]!;
  if (publicBaseUrl) {
    try {
      const url = new URL(publicBaseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== publicBaseUrl) {
        throw new Error();
      }
    } catch {
      errors.push('FALCON_PUBLIC_BASE_URL must be an origin such as https://crm.example.com');
    }
  }

  // All five or none — a half-configured bucket fails at upload time with a
  // credentials error, which is a worse signal than "not configured".
  const storageKeys = ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'];
  const storageValues = storageKeys.map((key) => env[key]?.trim() ?? '');
  const storageConfigured = storageValues.every((value) => value !== '');
  if (!storageConfigured && storageValues.some((value) => value !== '')) {
    errors.push(`Object storage needs all of ${storageKeys.join(', ')} or none of them`);
  }

  const webRoot = env.FALCON_WEB_ROOT?.trim() ?? '';

  if (errors.length) throw new Error(`Invalid Falcon API environment:\n- ${errors.join('\n- ')}`);
  return {
    ...(webRoot ? { webRoot } : {}),
    databaseUrl,
    httpPort,
    corsOrigins,
    emailTransport,
    logLevel,
    sessionCookieSecure: secureText === 'true',
    ...(emailTransport !== 'console' && deliveryConfigured
      ? {
          emailDelivery: {
            apiKey: deliveryValues[0]!,
            from: deliveryValues[1]!,
            publicBaseUrl: deliveryValues[2]!,
          },
        }
      : {}),
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
