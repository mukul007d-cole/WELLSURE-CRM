import type { SellerListRow, Status } from '../types/domain';

/**
 * Shared between the Board's drag/Move-menu mutation and the Seller List's
 * inline status control. A change may carry more than the status itself — a
 * reason, a follow-up and required-to-enter field values (ADR-0026) — and a
 * refusal is classified in `components/leads/status-entry.ts`.
 */
export interface StatusChangeVariables {
  row: SellerListRow;
  processInstanceId: string;
  journeyId: string;
  fromStatus: Status;
  toStatus: Status;
}
