export type ImportErrorCode = 'validation_error' | 'not_found' | 'conflict' | 'payload_too_large';

export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

export function isImportError(error: unknown): error is ImportError {
  return error instanceof ImportError;
}

/**
 * Not an error condition — the signal that a preview has finished and its
 * transaction should be discarded.
 *
 * Thrown at the very end of the run so the enclosing `$transaction` aborts,
 * which is what makes "the dry run writes nothing" a property of Postgres
 * rather than of application bookkeeping. Caught immediately outside, and its
 * payload is the response. See ADR-0016.
 */
export class DryRunRollback<T> extends Error {
  constructor(readonly payload: T) {
    super('dry run complete; rolling back');
    this.name = 'DryRunRollback';
  }
}

export function isDryRunRollback<T>(error: unknown): error is DryRunRollback<T> {
  return error instanceof DryRunRollback;
}
