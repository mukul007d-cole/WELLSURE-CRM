import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import type { Status } from '../../../types/domain';
import { StatusRoutingPanel } from '../StatusRoutingPanel';
import { StatusSwatch } from './JourneyStatusesTab';

/**
 * Per-Status routing, one expandable section per Status. The page mounts this
 * tab only for a `lead_routing:view` holder; the panel gates configuring and
 * granting itself.
 */
export function JourneyRoutingTab({
  journeyId,
  statuses,
  assignmentTypeSuggestions,
}: {
  journeyId: string;
  statuses: Status[];
  assignmentTypeSuggestions: readonly string[];
}) {
  /** Which Status's routing section is open — one at a time, as before. */
  const [openStatusId, setOpenStatusId] = useState<string | null>(null);
  return (
    <Card className="space-y-3 p-4">
      <div>
        <h3 className="font-display text-lg font-semibold">Routing</h3>
        <p className="text-sm text-ink-soft">
          Who a lead is assigned to when it enters each Status.
        </p>
      </div>
      <ol className="divide-y">
        {statuses.map((status) => (
          <li className="py-3" key={status.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <StatusSwatch status={status} />
                <span className="font-medium">{status.name}</span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={openStatusId === status.id}
                onClick={() => setOpenStatusId(openStatusId === status.id ? null : status.id)}
              >
                Routing
              </Button>
            </div>
            {/*
             * Routing is Status Visibility now, too (Phase 20): a Status
             * with an active routing rule is visible only to its current
             * assignee and that assignee's reporting-hierarchy ancestors —
             * `StatusRoutingPanel` says so directly wherever a rule is
             * active, rather than a separate panel/permission surface.
             */}
            {openStatusId === status.id ? (
              <div className="mt-3">
                <StatusRoutingPanel
                  statusId={status.id}
                  journeyId={journeyId}
                  assignmentTypeSuggestions={assignmentTypeSuggestions}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}
