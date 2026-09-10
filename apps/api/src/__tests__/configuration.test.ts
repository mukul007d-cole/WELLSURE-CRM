import { describe, expect, it } from 'vitest';
import {
  isPermissionPair,
  permissionCatalog,
  resolveAuthorization,
  type PermissionRepository,
} from '@falcon/permission-engine';

import { ConfigurationService } from '../configuration/service.js';
import {
  createField,
  createJourney,
  createService,
  deactivateField,
  deactivateJourney,
  deactivateService,
  deactivateStatus,
  readConfiguration,
  reorderFields,
  reorderStatuses,
  updateField,
  upsertFieldVisibility,
  type ConfigurationRouteResult,
} from '../routes/configuration.js';
import {
  MemoryConfigurationRepository,
  actorId,
  auth,
  catalogPermissionRepository,
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
      name: 'Test Select',
      fieldType: 'select',
      validationRule: { options: ['One', 'One'] },
      editMode: 'manual',
      source: 'manual',
    });
    expect(response.status).toBe(400);
  });

  describe('Field sort order', () => {
    it('appends new Fields to the end when sortOrder is omitted', async () => {
      const repository = new MemoryConfigurationRepository();
      const first = await createField({
        auth: auth(),
        permissionRepository: permissionRepository(),
        configurationRepository: repository,
        name: 'First',
        fieldType: 'text',
        editMode: 'manual',
        source: 'manual',
      });
      const second = await createField({
        auth: auth(),
        permissionRepository: permissionRepository(),
        configurationRepository: repository,
        name: 'Second',
        fieldType: 'text',
        editMode: 'manual',
        source: 'manual',
      });
      expect((first.body as { sortOrder: number }).sortOrder).toBe(0);
      expect((second.body as { sortOrder: number }).sortOrder).toBe(1);
    });

    it('reorders a complete field list atomically and audits every changed row', async () => {
      const repository = new MemoryConfigurationRepository();
      const first = await createField({
        auth: auth(),
        permissionRepository: permissionRepository(),
        configurationRepository: repository,
        name: 'First',
        fieldType: 'text',
        editMode: 'manual',
        source: 'manual',
      });
      const second = await createField({
        auth: auth(),
        permissionRepository: permissionRepository(),
        configurationRepository: repository,
        name: 'Second',
        fieldType: 'text',
        editMode: 'manual',
        source: 'manual',
      });
      const firstId = (first.body as { id: string }).id;
      const secondId = (second.body as { id: string }).id;

      const response = await reorderFields({
        auth: auth(),
        permissionRepository: permissionRepository(),
        configurationRepository: repository,
        fieldIds: [secondId, firstId],
      });
      expect(response.status).toBe(200);
      expect(repository.rows.fields.get(secondId)?.sortOrder).toBe(0);
      expect(repository.rows.fields.get(firstId)?.sortOrder).toBe(1);
      expect(repository.systemAudits.filter((audit) => audit.action === 'reorder')).toHaveLength(2);
    });

    it('rejects a reorder list with duplicate ids', async () => {
      const repository = new MemoryConfigurationRepository();
      const created = await createField({
        auth: auth(),
        permissionRepository: permissionRepository(),
        configurationRepository: repository,
        name: 'First',
        fieldType: 'text',
        editMode: 'manual',
        source: 'manual',
      });
      const fieldId = (created.body as { id: string }).id;
      const response = await reorderFields({
        auth: auth(),
        permissionRepository: permissionRepository(),
        configurationRepository: repository,
        fieldIds: [fieldId, fieldId],
      });
      expect(response.status).toBe(400);
    });
  });

  describe('calculated Field config', () => {
    it('stores a valid arithmetic calculation nested in validationRule', async () => {
      const repository = new MemoryConfigurationRepository();
      const revenue = await createField({
        auth: auth(),
        permissionRepository: permissionRepository(),
        configurationRepository: repository,
        name: 'Monthly Revenue',
        fieldType: 'number',
        editMode: 'manual',
        source: 'manual',
      });
      const revenueId = (revenue.body as { id: string }).id;

      const dealValue = await createField({
        auth: auth(),
        permissionRepository: permissionRepository(),
        configurationRepository: repository,
        name: 'Deal Value',
        fieldType: 'number',
        editMode: 'calculated',
        source: 'calculated',
        calculation: {
          kind: 'arithmetic',
          left: { type: 'field', fieldId: revenueId },
          operator: '*',
          right: { type: 'constant', value: 12 },
        },
      });
      expect(dealValue.status).toBe(201);
      expect((dealValue.body as { validationRule: unknown }).validationRule).toEqual({
        calculation: {
          kind: 'arithmetic',
          left: { type: 'field', fieldId: revenueId },
          operator: '*',
          right: { type: 'constant', value: 12 },
        },
      });
    });

    it('rejects a calculated field with no calculation config', async () => {
      const response = await createField({
        auth: auth(),
        permissionRepository: permissionRepository(),
        configurationRepository: new MemoryConfigurationRepository(),
        name: 'Deal Value',
        fieldType: 'number',
        editMode: 'calculated',
        source: 'calculated',
      });
      expect(response.status).toBe(400);
    });

    it('rejects a calculation referencing a field that does not exist', async () => {
      const response = await createField({
        auth: auth(),
        permissionRepository: permissionRepository(),
        configurationRepository: new MemoryConfigurationRepository(),
        name: 'Deal Value',
        fieldType: 'number',
        editMode: 'calculated',
        source: 'calculated',
        calculation: {
          kind: 'arithmetic',
          left: { type: 'field', fieldId: 'does-not-exist' },
          operator: '*',
          right: { type: 'constant', value: 12 },
        },
      });
      expect(response.status).toBe(400);
    });

    it('rejects chaining a calculated field onto another calculated field', async () => {
      const repository = new MemoryConfigurationRepository();
      const first = await createField({
        auth: auth(),
        permissionRepository: permissionRepository(),
        configurationRepository: repository,
        name: 'Base Calculation',
        fieldType: 'number',
        editMode: 'calculated',
        source: 'calculated',
        calculation: {
          kind: 'arithmetic',
          left: { type: 'constant', value: 1 },
          operator: '+',
          right: { type: 'constant', value: 1 },
        },
      });
      const firstId = (first.body as { id: string }).id;

      const chained = await createField({
        auth: auth(),
        permissionRepository: permissionRepository(),
        configurationRepository: repository,
        name: 'Chained Calculation',
        fieldType: 'number',
        editMode: 'calculated',
        source: 'calculated',
        calculation: {
          kind: 'arithmetic',
          left: { type: 'field', fieldId: firstId },
          operator: '+',
          right: { type: 'constant', value: 1 },
        },
      });
      expect(chained.status).toBe(400);
    });

    it('rejects a calculation config when edit mode is not calculated', async () => {
      const response = await createField({
        auth: auth(),
        permissionRepository: permissionRepository(),
        configurationRepository: new MemoryConfigurationRepository(),
        name: 'Not Calculated',
        fieldType: 'number',
        editMode: 'manual',
        source: 'manual',
        calculation: {
          kind: 'arithmetic',
          left: { type: 'constant', value: 1 },
          operator: '+',
          right: { type: 'constant', value: 1 },
        },
      });
      expect(response.status).toBe(400);
    });

    it('lets an update replace the calculation without the field colliding with itself', async () => {
      const repository = new MemoryConfigurationRepository();
      const created = await createField({
        auth: auth(),
        permissionRepository: permissionRepository(),
        configurationRepository: repository,
        name: 'Deal Value',
        fieldType: 'number',
        editMode: 'calculated',
        source: 'calculated',
        calculation: {
          kind: 'arithmetic',
          left: { type: 'constant', value: 1 },
          operator: '+',
          right: { type: 'constant', value: 1 },
        },
      });
      const fieldId = (created.body as { id: string }).id;

      const updated = await updateField({
        auth: auth(),
        permissionRepository: permissionRepository(),
        configurationRepository: repository,
        fieldId,
        name: 'Deal Value',
        fieldType: 'number',
        editMode: 'calculated',
        source: 'calculated',
        calculation: {
          kind: 'arithmetic',
          left: { type: 'constant', value: 2 },
          operator: '*',
          right: { type: 'constant', value: 3 },
        },
      });
      expect(updated.status).toBe(200);
      expect((updated.body as { validationRule: unknown }).validationRule).toEqual({
        calculation: {
          kind: 'arithmetic',
          left: { type: 'constant', value: 2 },
          operator: '*',
          right: { type: 'constant', value: 3 },
        },
      });
    });
  });

  describe('system Field config', () => {
    it('requires a non-blank key and stores it in validationRule', async () => {
      const response = await createField({
        auth: auth(),
        permissionRepository: permissionRepository(),
        configurationRepository: new MemoryConfigurationRepository(),
        name: 'Created Channel',
        fieldType: 'text',
        editMode: 'system',
        source: 'system',
        system: { key: 'creation_channel' },
      });
      expect(response.status).toBe(201);
      expect((response.body as { validationRule: unknown }).validationRule).toEqual({
        system: { key: 'creation_channel' },
      });
    });

    it('rejects a system field with no key', async () => {
      const response = await createField({
        auth: auth(),
        permissionRepository: permissionRepository(),
        configurationRepository: new MemoryConfigurationRepository(),
        name: 'Created Channel',
        fieldType: 'text',
        editMode: 'system',
        source: 'system',
      });
      expect(response.status).toBe(400);
    });

    it('rejects a system config when edit mode is not system', async () => {
      const response = await createField({
        auth: auth(),
        permissionRepository: permissionRepository(),
        configurationRepository: new MemoryConfigurationRepository(),
        name: 'Not System',
        fieldType: 'text',
        editMode: 'manual',
        source: 'manual',
        system: { key: 'creation_channel' },
      });
      expect(response.status).toBe(400);
    });
  });
});

/**
 * Regression: RoleJourneyAccess gates which journeys' *records* a role may
 * reach. It was also being applied to the configuration catalog, on top of the
 * feature-permission check that already gates it — so a role holding
 * journeys_statuses:view or fields:view but no journey grants saw nothing, and
 * had no way to reach the journey it needed in order to be granted access to
 * it.
 */
describe('configuration catalog visibility without journey access', () => {
  const noJourneyAccess = () => permissionRepository(true, { journeyAccess: false });

  it('lists journeys for a role with the feature permission and zero grants', async () => {
    const response = await readConfiguration({
      auth: auth(),
      permissionRepository: noJourneyAccess(),
      configurationRepository: new MemoryConfigurationRepository(),
      kind: 'journeys',
      page: 1,
      pageSize: 25,
    });

    expect(response.status).toBe(200);
    const body = response.body as { total: number; items: Array<{ id: string }> };
    expect(body.total).toBe(1);
    expect(body.items.map((item) => item.id)).toEqual([journeyId]);
  });

  it('reads a journey it has no explicit access to', async () => {
    const response = await readConfiguration({
      auth: auth(),
      permissionRepository: noJourneyAccess(),
      configurationRepository: new MemoryConfigurationRepository(),
      kind: 'journeys',
      id: journeyId,
      page: 1,
      pageSize: 25,
    });

    // The web app reads a journey's statuses from this route, so a 403 here
    // left every status picker empty even once the list worked.
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: journeyId });
  });

  it('lists fields for a role with zero grants', async () => {
    const repository = new MemoryConfigurationRepository();
    const created = await createField({
      auth: auth(),
      permissionRepository: permissionRepository(),
      configurationRepository: repository,
      name: 'Test Field A',
      fieldType: 'text',
      editMode: 'manual',
      source: 'manual',
    });
    expect(created.status).toBe(201);

    const response = await readConfiguration({
      auth: auth(),
      permissionRepository: noJourneyAccess(),
      configurationRepository: repository,
      kind: 'fields',
      page: 1,
      pageSize: 25,
    });

    expect(response.status).toBe(200);
    expect((response.body as { total: number }).total).toBe(1);
  });

  it('still refuses a role that lacks the feature permission', async () => {
    // The fix removes the journey filter, not the permission check.
    const response = await readConfiguration({
      auth: auth(),
      permissionRepository: permissionRepository(false),
      configurationRepository: new MemoryConfigurationRepository(),
      kind: 'journeys',
      page: 1,
      pageSize: 25,
    });

    expect(response).toEqual({ status: 403, body: { error: 'forbidden' } });
  });
});

/**
 * Regression: every configuration deactivation checked a `<module>:deactivate`
 * permission that the catalog has never defined for `journeys_statuses`,
 * `services` or `fields`.
 *
 * `role_permissions` rows are validated against the catalog on write and
 * `bootstrapFirstAdmin` creates the catalog and nothing else, so no role — the
 * initial administrator included — could hold one. Deactivating a Journey,
 * Status, Service or Field was denied for everybody, permanently.
 *
 * These cases grant exactly what bootstrap grants and drive the real
 * `resolveAuthorization`, so the grant set under test is the one a real
 * deployment can actually have.
 */
describe('configuration deactivation permission actions', () => {
  const wholeCatalog = permissionCatalog.flatMap(({ module, actions }) =>
    actions.map((action) => `${module}:${action}` as const),
  );
  const without = (pair: string) => wholeCatalog.filter((granted) => granted !== pair);

  type Grants = readonly `${string}:${string}`[];
  interface Target {
    repository: MemoryConfigurationRepository;
    id: string;
  }

  const create = async (
    repository: MemoryConfigurationRepository,
    write: (permissionRepository: PermissionRepository) => Promise<ConfigurationRouteResult>,
  ): Promise<Target> => {
    const created = await write(catalogPermissionRepository(wholeCatalog));
    expect(created.status).toBe(201);
    return { repository, id: (created.body as { id: string }).id };
  };

  /**
   * Per entity: the action its deactivation must require, a fixture holding one
   * of it, and the route call. `services` is the one module the catalog gives
   * no `delete` action, so its routes gate on `edit` — see the comments in
   * `routes/configuration.ts`.
   */
  const cases = [
    {
      name: 'Journey',
      requires: 'journeys_statuses:delete',
      seed: () =>
        Promise.resolve({ repository: new MemoryConfigurationRepository(), id: journeyId }),
      run: (granted: Grants, target: Target) =>
        deactivateJourney({
          auth: auth(),
          permissionRepository: catalogPermissionRepository(granted),
          configurationRepository: target.repository,
          journeyId: target.id,
        }),
    },
    {
      name: 'Status',
      requires: 'journeys_statuses:delete',
      seed: () =>
        Promise.resolve({ repository: new MemoryConfigurationRepository(), id: statusId }),
      run: (granted: Grants, target: Target) =>
        deactivateStatus({
          auth: auth(),
          permissionRepository: catalogPermissionRepository(granted),
          configurationRepository: target.repository,
          journeyId,
          statusId: target.id,
        }),
    },
    {
      name: 'Service',
      requires: 'services:edit',
      seed: () => {
        const repository = new MemoryConfigurationRepository();
        return create(repository, (permissionRepository) =>
          createService({
            auth: auth(),
            permissionRepository,
            configurationRepository: repository,
            name: 'Test Service A',
          }),
        );
      },
      run: (granted: Grants, target: Target) =>
        deactivateService({
          auth: auth(),
          permissionRepository: catalogPermissionRepository(granted),
          configurationRepository: target.repository,
          serviceId: target.id,
        }),
    },
    {
      name: 'Field',
      requires: 'fields:delete',
      seed: () => {
        const repository = new MemoryConfigurationRepository();
        return create(repository, (permissionRepository) =>
          createField({
            auth: auth(),
            permissionRepository,
            configurationRepository: repository,
            name: 'Test Field B',
            fieldType: 'text',
            editMode: 'manual',
            source: 'manual',
          }),
        );
      },
      run: (granted: Grants, target: Target) =>
        deactivateField({
          auth: auth(),
          permissionRepository: catalogPermissionRepository(granted),
          configurationRepository: target.repository,
          fieldId: target.id,
        }),
    },
  ] as const;

  for (const { name, requires, run, seed } of cases) {
    it(`deactivates a ${name} for a role holding the whole catalog`, async () => {
      const target = await seed();
      const response = await run(wholeCatalog, target);
      expect(response).toMatchObject({ status: 200 });
      expect(target.repository.systemAudits.at(-1)?.action).toBe('deactivate');
    });

    it(`denies ${name} deactivation to a role missing ${requires}`, async () => {
      const target = await seed();
      const response = await run(without(requires), target);
      expect(response).toEqual({ status: 403, body: { error: 'forbidden' } });
    });
  }

  /**
   * The 403 body is a bare code, so the *reason* is asserted where the engine
   * produces it: a missing module action, not a journey or record-scope denial.
   */
  it('denies the missing action at the feature-permission axis', async () => {
    const decision = await resolveAuthorization({
      repository: catalogPermissionRepository(without('journeys_statuses:delete')),
      request: {
        organizationId: orgA,
        userId: actorId,
        module: 'journeys_statuses',
        action: 'delete',
        journeyId,
      },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.deniedReasons).toEqual(['FEATURE_ACTION_DENIED']);
    expect(decision.journeyAllowed).toBe(true);
  });

  /**
   * The pair the routes used to ask for. It is absent from the catalog, so no
   * role can hold it and `admin/validation` refuses to store it — asserted here
   * so re-introducing `<module>:deactivate` anywhere fails loudly.
   */
  it('has no deactivate action in the catalog for any configuration module', () => {
    for (const module of ['journeys_statuses', 'services', 'fields'] as const)
      expect(isPermissionPair(module, 'deactivate')).toBe(false);
  });
});
