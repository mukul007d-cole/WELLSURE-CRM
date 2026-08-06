import { describe, expect, it } from 'vitest';

import { ConfigurationService } from '../configuration/service.js';
import {
  createField,
  createJourney,
  deactivateStatus,
  reorderStatuses,
  upsertFieldVisibility,
} from '../routes/configuration.js';
import {
  MemoryConfigurationRepository,
  actorId,
  auth,
  journeyId,
  orgA,
  permissionRepository,
  replacementStatusId,
  statusId,
} from './fixtures/synthetic-configuration.js';

describe('configuration engine API', () => {
  it('enforces permissions before creating configuration records', async () => {
    const response = await createJourney({
      auth: auth(),
      permissionRepository: permissionRepository(false),
      configurationRepository: new MemoryConfigurationRepository(),
      key: 'test_journey_b',
      name: 'Test Journey B',
    });
    expect(response).toEqual({ status: 403, body: { error: 'forbidden' } });
  });

  it('creates Journey records with synthetic data and system audit', async () => {
    const repository = new MemoryConfigurationRepository();
    const response = await createJourney({
      auth: auth(),
      permissionRepository: permissionRepository(),
      configurationRepository: repository,
      key: 'test_journey_b',
      name: 'Test Journey B',
    });
    expect(response.status).toBe(201);
    expect(repository.systemAudits).toMatchObject([
      {
        organizationId: orgA,
        actorUserId: actorId,
        entityType: 'journey',
        action: 'create',
        oldValue: null,
      },
    ]);
  });

  /**
   * Journey access is an explicit allow-list, and creation used to populate it
   * for nobody — so a new Journey was filtered out of every list, including for
   * the role that created it, and came back as an empty 200 rather than a 403.
   */
  it('grants the new Journey to config-visible roles so it is not created invisible', async () => {
    const repository = new MemoryConfigurationRepository();
    repository.configRoleIds = ['role-config-a', 'role-config-b'];

    const response = await createJourney({
      auth: auth(),
      permissionRepository: permissionRepository(),
      configurationRepository: repository,
      key: 'test_journey_c',
      name: 'Test Journey C',
    });

    expect(response.status).toBe(201);
    const journeyRow = (response as { status: 201; body: { id: string } }).body;
    expect(repository.grantedJourneyAccess).toEqual([
      { journeyId: journeyRow.id, roleIds: ['role-config-a', 'role-config-b'] },
    ]);
    // The visibility grant is audited separately from the Journey itself.
    expect(repository.systemAudits).toMatchObject([
      { entityType: 'journey', action: 'create' },
      {
        entityType: 'journey',
        action: 'edit',
        newValue: { grantedRoleIds: repository.configRoleIds },
      },
    ]);
  });

  it('records no access grant when no role can see Journey configuration', async () => {
    const repository = new MemoryConfigurationRepository();
    repository.configRoleIds = [];

    await createJourney({
      auth: auth(),
      permissionRepository: permissionRepository(),
      configurationRepository: repository,
      key: 'test_journey_d',
      name: 'Test Journey D',
    });

    expect(repository.grantedJourneyAccess).toHaveLength(1);
    expect(repository.grantedJourneyAccess[0]?.roleIds).toEqual([]);
    // Nothing granted, so nothing to audit beyond the creation itself.
    expect(repository.systemAudits).toHaveLength(1);
  });

  it('blocks status deactivation with active process instances until a same-journey replacement is provided', async () => {
    const repository = new MemoryConfigurationRepository();
    repository.processInstances.push({
      id: '66666666-6666-6666-6666-666666666666',
      organizationId: orgA,
      leadId: '77777777-7777-7777-7777-777777777777',
      journeyId,
      currentStatusId: statusId,
    });

    const blocked = await deactivateStatus({
      auth: auth(),
      permissionRepository: permissionRepository(),
      configurationRepository: repository,
      journeyId,
      statusId,
    });
    expect(blocked).toEqual({
      status: 409,
      body: { error: 'dependency_conflict', details: { activeProcessInstances: 1 } },
    });

    const reassigned = await deactivateStatus({
      auth: auth(),
      permissionRepository: permissionRepository(),
      configurationRepository: repository,
      journeyId,
      statusId,
      replacementStatusId,
    });
    expect(reassigned.status).toBe(200);
    expect(repository.processInstances[0]?.currentStatusId).toBe(replacementStatusId);
    const audit = repository.systemAudits.at(-1);
    expect(audit?.entityType).toBe('status');
    expect(audit?.action).toBe('reassign_and_deactivate');
    expect(
      (audit?.newValue as { reassignedProcessInstances?: number } | undefined)
        ?.reassignedProcessInstances,
    ).toBe(1);
    expect(repository.activities).toEqual([
      {
        organizationId: orgA,
        leadId: '77777777-7777-7777-7777-777777777777',
        processInstanceId: '66666666-6666-6666-6666-666666666666',
        actorUserId: actorId,
        actionType: 'status_change',
        source: 'configuration_engine',
        oldValue: { statusId },
        newValue: { statusId: replacementStatusId },
      },
    ]);
  });

  it('uses real DELETE semantics for field visibility mapping rows and audits the old value', async () => {
    const repository = new MemoryConfigurationRepository();
    const service = new ConfigurationService(repository);
    const field = await service.createField({
      organizationId: orgA,
      actorUserId: actorId,
      key: 'test_field_a',
      name: 'Test Field A',
      fieldType: 'text',
      editMode: 'manual',
      source: 'manual',
    });
    const visible = await upsertFieldVisibility({
      auth: auth(),
      permissionRepository: permissionRepository(),
      configurationRepository: repository,
      fieldId: field.id,
      roleId: '88888888-8888-8888-8888-888888888888',
      accessLevel: 'EDIT',
    });
    expect(visible.status).toBe(200);
    await service.deleteFieldVisibility({
      organizationId: orgA,
      actorUserId: actorId,
      fieldId: field.id,
      roleId: '88888888-8888-8888-8888-888888888888',
    });
    expect(repository.rows.fieldVisibility.size).toBe(0);
    expect(repository.systemAudits.at(-1)).toMatchObject({
      entityType: 'field_visibility',
      action: 'delete',
      newValue: null,
    });
  });

  it('validates field edit mode and source without business-specific names', async () => {
    const response = await createField({
      auth: auth(),
      permissionRepository: permissionRepository(),
      configurationRepository: new MemoryConfigurationRepository(),
      key: 'test_field_a',
      name: 'Test Field A',
      fieldType: 'text',
      editMode: 'invalid',
      source: 'manual',
    });
    expect(response.status).toBe(400);
  });

  it('reorders a complete status list atomically and audits every changed row', async () => {
    const repository = new MemoryConfigurationRepository();
    const response = await reorderStatuses({
      auth: auth(),
      permissionRepository: permissionRepository(),
      configurationRepository: repository,
      journeyId,
      statusIds: [replacementStatusId, statusId],
    });
    expect(response.status).toBe(200);
    expect(repository.rows.statuses.get(replacementStatusId)?.sortOrder).toBe(0);
    expect(repository.rows.statuses.get(statusId)?.sortOrder).toBe(1);
    expect(repository.systemAudits.filter((audit) => audit.action === 'reorder')).toHaveLength(2);
  });

  it('requires unique non-blank options for select Fields', async () => {
    const response = await createField({
      auth: auth(),
      permissionRepository: permissionRepository(),
      configurationRepository: new MemoryConfigurationRepository(),
      key: 'test_select',
      name: 'Test Select',
      fieldType: 'select',
      validationRule: { options: ['One', 'One'] },
      editMode: 'manual',
      source: 'manual',
    });
    expect(response.status).toBe(400);
  });
});
