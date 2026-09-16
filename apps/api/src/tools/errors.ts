export type ToolErrorCode =
  | 'not_found'
  | 'validation_error'
  | 'conflict'
  /** Mirrors attachments' `storage_not_configured` — object storage is optional (ADR-0012). */
  | 'storage_not_configured';

export class ToolError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function isToolError(error: unknown): error is ToolError {
  return error instanceof ToolError;
}
