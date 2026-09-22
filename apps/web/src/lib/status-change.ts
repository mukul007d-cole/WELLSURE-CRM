import { ApiError } from './api-error';
import type { SellerListRow, Status } from '../types/domain';

/**
 * Shared between the Board's drag/Move-menu mutation and the Seller List's
 * inline status control — both call `sellersApi.edit` with only a `statusId`
 * change and need to react to the same server error shape the same way.
 */
export interface StatusChangeVariables {
  row: SellerListRow;
  processInstanceId: string;
  journeyId: string;
  fromStatus: Status;
  toStatus: Status;
}

/** Why a status change was refused, in terms a caller can act on. */
export type StatusChangeRejection =
  | { kind: 'missing_field'; fieldId: string; variables: StatusChangeVariables }
  | { kind: 'forbidden' }
  | { kind: 'stale_status' }
  | { kind: 'other'; error: unknown };

export function classifyStatusChangeRejection(
  error: unknown,
  variables: StatusChangeVariables,
): StatusChangeRejection {
  if (!(error instanceof ApiError)) return { kind: 'other', error };

  if (error.status === 403) return { kind: 'forbidden' };

  if (error.status === 400 && error.code === 'validation_error') {
    // The API reports the *first* field that's required at the destination and
    // still empty. We key off details.fieldId rather than the status code,
    // because "status isn't valid on this journey" is also a 400 — but carries
    // no details.
    const fieldId = error.details?.['fieldId'];
    if (typeof fieldId === 'string') return { kind: 'missing_field', fieldId, variables };
    return { kind: 'stale_status' };
  }

  return { kind: 'other', error };
}
