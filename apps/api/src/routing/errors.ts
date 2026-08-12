export type RoutingErrorCode = 'not_found' | 'validation_error' | 'conflict';

export class RoutingError extends Error {
  constructor(
    readonly code: RoutingErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function isRoutingError(error: unknown): error is RoutingError {
  return error instanceof RoutingError;
}
