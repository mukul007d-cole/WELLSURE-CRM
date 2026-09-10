export type StatusVisibilityErrorCode = 'not_found' | 'validation_error' | 'conflict';

export class StatusVisibilityError extends Error {
  constructor(
    readonly code: StatusVisibilityErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function isStatusVisibilityError(error: unknown): error is StatusVisibilityError {
  return error instanceof StatusVisibilityError;
}
