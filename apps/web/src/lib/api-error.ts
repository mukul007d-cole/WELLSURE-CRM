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
  invalid_token: 'This password link is invalid or has already been used.',
  expired_token: 'This password link has expired. Request a new one to continue.',
  weak_password: 'Choose a stronger password.',
  invalid_current_password: 'The current password is incorrect.',
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

const PASSWORD_POLICY_MESSAGES: Record<string, string> = {
  minimum_12_characters: 'Use at least 12 characters.',
  uppercase_required: 'Include an uppercase letter.',
  lowercase_required: 'Include a lowercase letter.',
  number_required: 'Include a number.',
  symbol_required: 'Include a symbol.',
};

export function passwordPolicyErrorMessage(error: ApiError): string {
  const reasons = Array.isArray(error.details?.reasons) ? error.details.reasons : [];
  return (
    reasons
      .map(String)
      .map((reason) => PASSWORD_POLICY_MESSAGES[reason] ?? reason)
      .join(' ') || friendlyErrorMessage(error)
  );
}
