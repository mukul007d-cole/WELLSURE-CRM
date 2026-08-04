import { describe, expect, it } from 'vitest';
import { LeadSharingService } from '../leads/sharing.js';
import {
  NotificationService,
  notificationTriggers,
  recipientResolvers,
} from '../notifications/service.js';

describe('Phase 9 closed catalogs and validation', () => {
  it('publishes only the approved trigger and recipient primitive catalogs', () => {
    expect(notificationTriggers).toEqual([
      'field_edited',
      'status_changed',
      'lead_reassigned',
      'shared_lead_modified_by_non_owner',
      'lead_deactivated',
    ]);
    expect(recipientResolvers).toEqual([
      'assignment_holder',
      'assignment_holder_manager',
      'previous_assignment_holder',
      'share_creator',
      'active_shared_users_except_actor',
      'feature_permission_holders',
    ]);
  });

  it('rejects a share without view before persistence', async () => {
    const service = new LeadSharingService({} as never);
    await expect(
      service.create({
        organizationId: 'org',
        leadId: 'lead',
        userId: 'recipient',
        actorUserId: 'actor',
        capabilities: ['edit'],
      }),
    ).rejects.toThrow('invalid_capabilities');
  });

  it('rejects unknown rule primitives before persistence', async () => {
    const service = new NotificationService({} as never);
    await expect(
      service.createRule({
        organizationId: 'org',
        actorUserId: 'actor',
        key: 'synthetic_rule',
        name: 'Synthetic',
        triggerType: 'unknown',
        recipients: [{ resolverType: 'assignment_holder' }],
      }),
    ).rejects.toThrow('validation_error');
  });
});
