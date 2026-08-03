export interface ApiEnv {
  databaseUrl: string;
  httpPort: number;
  corsOrigins: string[];
  emailTransport: string;
  logLevel: string;
  sessionCookieSecure: boolean;
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
  if (errors.length) throw new Error(`Invalid Falcon API environment:\n- ${errors.join('\n- ')}`);
  return {
    databaseUrl,
    httpPort,
    corsOrigins,
    emailTransport,
    logLevel,
    sessionCookieSecure: secureText === 'true',
  };
}
