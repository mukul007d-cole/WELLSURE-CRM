import { resolveAuthorization, type PermissionRepository } from '@falcon/permission-engine';

import type { AuthenticatedContext } from '../auth/middleware.js';

export const leadsModule = 'leads' as const;
export const viewAction = 'view' as const;
export const defaultAssignmentTypes = ['primary'] as const;

export interface LeadDetailRecord {
  id: string;
  organizationId: string;
  name: string;
  phone: string | null;
  email: string | null;
  fieldValues: Record<string, unknown>;
  processInstances: Array<{ journeyId: string; active: boolean }>;
}

export interface LeadReadRepository {
  findLeadById(organizationId: string, leadId: string): Promise<LeadDetailRecord | null>;
}

export async function getLeadById(input: {
  auth: AuthenticatedContext;
  leadId: string;
  leadRepository: LeadReadRepository;
  permissionRepository: PermissionRepository;
  requestedFieldIds: readonly string[];
  now?: Date | undefined;
}): Promise<{ status: 200; body: unknown } | { status: 403 | 404; body: { error: string } }> {
  const lead = await input.leadRepository.findLeadById(
    input.auth.user.organizationId,
    input.leadId,
  );
  const process = lead?.processInstances.find((row) => row.active);
  if (lead === null || lead === undefined || process === undefined) {
    return { status: 404, body: { error: 'not_found' } };
  }

  const request = {
    organizationId: input.auth.user.organizationId,
    userId: input.auth.user.id,
    module: leadsModule,
    action: viewAction,
    journeyId: process.journeyId,
    leadId: lead.id,
    requestedFieldIds: input.requestedFieldIds,
    assignmentTypes: defaultAssignmentTypes,
    ...(input.now === undefined ? {} : { now: input.now }),
  };
  const decision = await resolveAuthorization({
    repository: input.permissionRepository,
    request,
  });

  const blockingReasons = decision.deniedReasons.filter((reason) => reason !== 'FIELD_VIEW_DENIED');
  if (blockingReasons.length > 0) {
    return { status: 403, body: { error: 'forbidden' } };
  }

  const visible = new Set(decision.fields.visibleFieldIds);
  return {
    status: 200,
    body: {
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      fieldValues: Object.fromEntries(
        Object.entries(lead.fieldValues).filter(([fieldId]) => visible.has(fieldId)),
      ),
    },
  };
}
