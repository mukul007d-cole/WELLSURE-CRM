import { useCallback } from 'react';

import type { Journey } from '../types/domain';
import { useAuth } from './AuthContext';

/**
 * A react-query `select` that narrows the journey catalogue to the journeys
 * the signed-in user can actually work: their role's journey access, minus
 * members-only journeys they are not a member of (ADR-0026). The server
 * resolves both into `capabilities.journeyIds`, so this never re-derives
 * either rule — it only stops lead screens offering a journey whose every
 * request would be refused. Admin screens keep the whole catalogue.
 */
export function useWorkableJourneySelect(): (journeys: Journey[]) => Journey[] {
  const { capabilities } = useAuth();
  const allowed = capabilities?.journeyIds;
  return useCallback(
    (journeys: Journey[]) =>
      allowed === undefined ? journeys : journeys.filter((journey) => allowed.includes(journey.id)),
    [allowed],
  );
}
