export type LeadErrorCode = 'validation_error' | 'not_found' | 'dependency_conflict' | 'forbidden';

export class LeadError extends Error {
  constructor(
    readonly code: LeadErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function isLeadError(error: unknown): error is LeadError {
  return error instanceof LeadError;
}
