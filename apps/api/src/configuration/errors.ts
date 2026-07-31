export type ConfigurationErrorCode =
  'not_found' | 'forbidden' | 'validation_error' | 'dependency_conflict';

export class ConfigurationError extends Error {
  constructor(
    readonly code: ConfigurationErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function isConfigurationError(error: unknown): error is ConfigurationError {
  return error instanceof ConfigurationError;
}
