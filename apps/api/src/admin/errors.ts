export type AdminErrorCode = 'not_found' | 'validation_error' | 'conflict';

export class AdminError extends Error {
  constructor(
    readonly code: AdminErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function isAdminError(error: unknown): error is AdminError {
  return error instanceof AdminError;
}
