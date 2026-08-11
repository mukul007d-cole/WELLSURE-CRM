import { resolveAuthorization, type PermissionRepository } from '@falcon/permission-engine';

import type { AuthenticatedContext } from '../auth/middleware.js';
import {
  isCampaignError,
  type CampaignService,
  type CampaignWriteInput,
} from '../campaigns/service.js';
import type { CampaignSendService } from '../campaigns/send-service.js';
import { filterFieldIds } from '../leads/filter-model.js';
import { parseFilter, resolveFilter } from '../leads/filter-validation.js';
import { isLeadError } from '../leads/errors.js';
import type { SellerReadRepository } from './leads.js';

export const campaignsModule = 'campaigns' as const;

export type CampaignRouteResult =
  | { status: 200 | 201; body: unknown }
  | { status: 400 | 403 | 404 | 409; body: { error: string; details?: Record<string, unknown> } };

export interface CampaignRouteDeps {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  campaignService: CampaignService;
  campaignSendService: CampaignSendService;
  sellerRepository: SellerReadRepository;
}

/**
 * Every campaign route resolves the real decision first. `campaigns:send` is
 * checked separately from `campaigns:edit` — composing an email and mailing
 * customers are different levels of trust, so holding one never implies the
 * other.
 */
async function authorize(
  input: CampaignRouteDeps,
  action: 'view' | 'create' | 'edit' | 'send',
  requestedFieldIds: readonly string[] = [],
) {
  return resolveAuthorization({
    repository: input.permissionRepository,
    request: {
      organizationId: input.auth.user.organizationId,
      userId: input.auth.user.id,
      module: campaignsModule,
      action,
      requestedFieldIds,
    },
  });
}

/** The Fields this author may reference as variables. */
async function visibleFieldIds(
  input: CampaignRouteDeps,
  action: 'create' | 'edit',
): Promise<ReadonlySet<string>> {
  const fieldTypes = await input.sellerRepository.listFilterableFieldTypes(
    input.auth.user.organizationId,
  );
  const decision = await authorize(input, action, [...fieldTypes.keys()]);
  return new Set(decision.fields.visibleFieldIds);
}

export async function listCampaigns(
  input: CampaignRouteDeps & { page?: number; pageSize?: number },
): Promise<CampaignRouteResult> {
  const decision = await authorize(input, 'view');
  if (!allowed(decision)) return forbidden();
  return {
    status: 200,
    body: await input.campaignService.list(
      input.auth.user.organizationId,
      input.page ?? 1,
      input.pageSize ?? 25,
    ),
  };
}

export async function getCampaign(
  input: CampaignRouteDeps & { id: string },
): Promise<CampaignRouteResult> {
  const decision = await authorize(input, 'view');
  if (!allowed(decision)) return forbidden();
  const campaign = await input.campaignService.get(input.auth.user.organizationId, input.id);
  return campaign === null ? notFound() : { status: 200, body: campaign };
}

export async function createCampaign(
  input: CampaignRouteDeps & { campaign: CampaignWriteInput },
): Promise<CampaignRouteResult> {
  const decision = await authorize(input, 'create');
  if (!allowed(decision)) return forbidden();
  return run(async () => ({
    status: 201,
    body: await input.campaignService.create({
      organizationId: input.auth.user.organizationId,
      actorUserId: input.auth.user.id,
      visibleFieldIds: await visibleFieldIds(input, 'create'),
      campaign: input.campaign,
    }),
  }));
}

export async function updateCampaign(
  input: CampaignRouteDeps & { id: string; campaign: CampaignWriteInput },
): Promise<CampaignRouteResult> {
  const decision = await authorize(input, 'edit');
  if (!allowed(decision)) return forbidden();
  return run(async () => {
    const row = await input.campaignService.update({
      organizationId: input.auth.user.organizationId,
      actorUserId: input.auth.user.id,
      id: input.id,
      visibleFieldIds: await visibleFieldIds(input, 'edit'),
      campaign: input.campaign,
    });
    return row === null ? notFound() : { status: 200, body: row };
  });
}

export async function setCampaignActive(
  input: CampaignRouteDeps & { id: string; active: boolean },
): Promise<CampaignRouteResult> {
  const decision = await authorize(input, 'edit');
  if (!allowed(decision)) return forbidden();
  return run(async () => {
    const row = await input.campaignService.setActive({
      organizationId: input.auth.user.organizationId,
      actorUserId: input.auth.user.id,
      id: input.id,
      active: input.active,
    });
    return row === null ? notFound() : { status: 200, body: row };
  });
}

/** Manual sends may not exceed this in one request; see the 13c plan. */
export const maxManualRecipients = 5000;

export async function sendCampaign(
  input: CampaignRouteDeps & { id: string },
): Promise<CampaignRouteResult> {
  const decision = await authorize(input, 'send');
  if (!allowed(decision)) return forbidden();
  const organizationId = input.auth.user.organizationId;
  const campaign = await input.campaignService.get(organizationId, input.id);
  if (campaign === null) return notFound();
  if (campaign.type !== 'manual')
    return {
      status: 400,
      body: { error: 'validation_error', details: { reason: 'campaign is not manual' } },
    };
  if (!campaign.active)
    return {
      status: 409,
      body: { error: 'conflict', details: { reason: 'campaign is not active' } },
    };

  // The recipient set is the stored 13b filter, evaluated now, through the same
  // compiler the Seller List uses — including the sender's own data scope, so a
  // campaign can never reach records its sender could not list.
  const leadDecision = await resolveAuthorization({
    repository: input.permissionRepository,
    request: {
      organizationId,
      userId: input.auth.user.id,
      module: 'leads',
      action: 'view',
      requestedFieldIds: [],
    },
  });
  const blocking = leadDecision.deniedReasons.filter((reason) => reason !== 'FIELD_VIEW_DENIED');
  if (blocking.length > 0 || leadDecision.recordPredicate === null) return forbidden();

  let conditions;
  try {
    const filter = parseFilter(campaign.filter);
    const fieldTypes = await input.sellerRepository.listFilterableFieldTypes(organizationId);
    const visible = new Set(
      (await authorize(input, 'send', [...fieldTypes.keys()])).fields.visibleFieldIds,
    );
    // A stored filter is re-validated against the *sender's* visibility, not
    // the author's: the filter selects records, and the sender is the one
    // acting.
    if (filterFieldIds(filter).some((fieldId) => !visible.has(fieldId))) return forbidden();
    conditions = resolveFilter({ filter, fieldTypes });
  } catch (error) {
    if (!isLeadError(error)) throw error;
    return { status: 400, body: { error: error.code, details: error.details } };
  }

  // One past the cap tells us it was exceeded without counting the whole table.
  const leadIds = await input.sellerRepository.listMatchingLeadIds({
    organizationId,
    recordPredicate: leadDecision.recordPredicate,
    conditions,
    limit: maxManualRecipients + 1,
  });
  if (leadIds.length > maxManualRecipients)
    return {
      status: 409,
      body: {
        error: 'conflict',
        details: { reason: 'too many recipients', maxManualRecipients },
      },
    };

  const queued = await input.campaignService.queueManualSend({
    organizationId,
    campaignId: input.id,
    leadIds,
  });
  // Delivery happens after the recording transaction has committed.
  const drained = await input.campaignSendService.drainPending(organizationId);
  return { status: 200, body: { queued, ...drained } };
}

function allowed(decision: Awaited<ReturnType<typeof resolveAuthorization>>): boolean {
  // A denied *field* never blocks a campaign route; the field checks above are
  // what govern variables and filters.
  return decision.deniedReasons.filter((reason) => reason !== 'FIELD_VIEW_DENIED').length === 0;
}
function forbidden(): CampaignRouteResult {
  return { status: 403, body: { error: 'forbidden' } };
}
function notFound(): CampaignRouteResult {
  return { status: 404, body: { error: 'not_found' } };
}
async function run(work: () => Promise<CampaignRouteResult>): Promise<CampaignRouteResult> {
  try {
    return await work();
  } catch (error) {
    if (!isCampaignError(error)) throw error;
    return {
      status:
        error.code === 'not_found'
          ? 404
          : error.code === 'conflict'
            ? 409
            : error.code === 'forbidden'
              ? 403
              : 400,
      body: {
        error: error.code,
        ...(Object.keys(error.details).length === 0 ? {} : { details: error.details }),
      },
    };
  }
}
