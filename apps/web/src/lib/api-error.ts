import type { ApiErrorBody } from '../types/domain';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown> | undefined;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error);
    this.status = status;
    this.code = body.error;
    this.details = body.details;
  }
}

const FRIENDLY_MESSAGES: Record<string, string> = {
  invalid_credentials: 'That email or password doesn’t match our records.',
  validation_error: 'Some fields need a second look before this can be saved.',
  not_found: 'That record couldn’t be found — it may have been moved or deactivated.',
  dependency_conflict: 'This action conflicts with something else in the system.',
  forbidden: 'You don’t have permission to do that.',
};

export function friendlyErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return FRIENDLY_MESSAGES[error.code] ?? error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Something unexpected happened.';
}
