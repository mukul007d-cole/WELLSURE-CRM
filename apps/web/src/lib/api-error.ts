import type { ApiErrorBody } from '../types/domain';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly reason?: string | undefined;
  readonly details?: Record<string, unknown> | undefined;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error);
    this.status = status;
    this.code = body.error;
    this.reason = body.reason;
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
    // `validation_error` covers many distinct reasons ("required field is
    // missing", "field is locked and cannot be changed", an invalid
    // status, …) behind one code — a route that names which one
    // (`error.reason`, e.g. lead mutations) lets this say something a
    // person can act on instead of the same generic sentence for all of
    // them. Every `reason` this project sends is a short, developer-
    // authored constant, never user input, so showing it verbatim is safe.
    if (error.code === 'validation_error' && error.reason) {
      return `${capitalize(error.reason)}.`;
    }
    return FRIENDLY_MESSAGES[error.code] ?? error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Something unexpected happened.';
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
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
