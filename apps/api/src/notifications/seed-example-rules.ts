import type { FalconPrismaClient } from '@falcon/database';

export async function seedExampleNotificationRules(input: {
  prisma: FalconPrismaClient;
  organizationId: string;
  actorUserId: string;
  ownerAssignmentType: string;
  adminModule: string;
  adminAction: string;
}) {
  const examples = [
    {
      key: 'lead_modified_example',
      name: 'Lead modified',
      triggerType: 'field_edited',
      recipients: [
        ['assignment_holder', { assignmentType: input.ownerAssignmentType }],
        ['assignment_holder_manager', { assignmentType: input.ownerAssignmentType }],
      ],
    },
    {
      key: 'shared_lead_modified_example',
      name: 'Shared lead modified',
      triggerType: 'shared_lead_modified_by_non_owner',
      recipients: [
        ['active_shared_users_except_actor', {}],
        ['assignment_holder', { assignmentType: input.ownerAssignmentType }],
      ],
    },
    {
      key: 'lead_reassigned_example',
      name: 'Lead reassigned',
      triggerType: 'lead_reassigned',
      recipients: [
        ['previous_assignment_holder', {}],
        ['assignment_holder', { assignmentType: input.ownerAssignmentType }],
        ['assignment_holder_manager', { assignmentType: input.ownerAssignmentType }],
      ],
    },
    {
      key: 'lead_deactivated_example',
      name: 'Lead deactivated',
      triggerType: 'lead_deactivated',
      recipients: [
        ['feature_permission_holders', { module: input.adminModule, action: input.adminAction }],
        ['assignment_holder_manager', { assignmentType: input.ownerAssignmentType }],
      ],
    },
  ] as const;
  for (const example of examples)
    await input.prisma.notificationRule.upsert({
      where: { organizationId_key: { organizationId: input.organizationId, key: example.key } },
      update: {},
      create: {
        organizationId: input.organizationId,
        key: example.key,
        name: example.name,
        triggerType: example.triggerType,
        createdById: input.actorUserId,
        updatedById: input.actorUserId,
        recipients: {
          create: example.recipients.map(([resolverType, parameters], sortOrder) => ({
            organizationId: input.organizationId,
            resolverType,
            parameters,
            sortOrder,
          })),
        },
      },
    });
}
