import { http, HttpResponse, delay } from 'msw';
import {
  DIRECTORY_USERS,
  FIELDS,
  JOURNEYS,
  LEADS,
  ORGANIZATION_ID,
  SERVICES,
  STATUSES,
  USERS,
  type MockLead,
} from './fixtures';
import { isLeadInScope, stripFieldValues } from './permissions';
import {
  clearCookieHeader,
  createSession,
  currentSessionToken,
  destroySession,
  resolveUserId,
  setCookieHeader,
} from './session';
import type { NotificationItem } from '../types/domain';

const API_BASE = '/api/v1';
const MOCK_SHARES: Array<{
  id: string;
  leadId: string;
  userId: string;
  userName: string;
  grantedByUserId: string;
  capabilities: string[];
  createdAt: string;
}> = [];

interface MockActivityEntry {
  id: string;
  processInstanceId: string | null;
  actorUserId: string | null;
  actorName: string | null;
  timestamp: string;
  actionType: string;
  source: string;
  commentText: string | null;
  oldValue: unknown;
  newValue: unknown;
}

/** Comments, reassignments and deactivations appended during a session. */
const MOCK_ACTIVITY: Record<string, MockActivityEntry[]> = {};

interface MockAttachment {
  id: string;
  leadId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedById: string;
  uploadedByName: string | null;
  uploadedAt: string;
}

/** In-memory locker. Real uploads need MinIO; the mock just remembers names. */
const MOCK_ATTACHMENTS: MockAttachment[] = [];

/**
 * A seeded history so the dev demo shows a populated timeline rather than an
 * empty state, covering every `actionType` the renderer handles.
 *
 * Deterministic offsets from the lead's own index keep ordering stable across
 * reloads; the real endpoint sorts by timestamp desc.
 */
function activityFor(leadId: string): MockActivityEntry[] {
  const lead = LEADS.find((row) => row.id === leadId);
  if (!lead) return MOCK_ACTIVITY[leadId] ?? [];
  const process = lead.processInstances[0];
  const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  const [first, second] = USERS;

  const seeded: MockActivityEntry[] = [
    {
      id: `${leadId}-activity-status`,
      processInstanceId: process?.processInstanceId ?? null,
      actorUserId: first!.id,
      actorName: first!.name,
      timestamp: at(1),
      actionType: 'status_change',
      source: 'lead_api',
      commentText: null,
      oldValue: { statusId: `status-${JOURNEYS[0]!.key}-new` },
      newValue: { statusId: process?.statusId ?? '' },
    },
    {
      id: `${leadId}-activity-edit`,
      processInstanceId: process?.processInstanceId ?? null,
      actorUserId: second!.id,
      actorName: second!.name,
      timestamp: at(3),
      actionType: 'field_edit',
      source: 'lead_api',
      commentText: null,
      oldValue: { name: lead.name, fieldValues: { ...lead.fieldValues, category: 'Unassigned' } },
      newValue: { name: lead.name, fieldValues: lead.fieldValues },
    },
    {
      id: `${leadId}-activity-share`,
      processInstanceId: process?.processInstanceId ?? null,
      actorUserId: first!.id,
      actorName: first!.name,
      timestamp: at(5),
      actionType: 'share_changed',
      source: 'lead_api',
      commentText: null,
      oldValue: null,
      newValue: { userId: second!.id },
    },
    {
      id: `${leadId}-activity-comment`,
      processInstanceId: null,
      actorUserId: second!.id,
      actorName: second!.name,
      timestamp: at(6),
      actionType: 'comment',
      source: 'lead_api',
      commentText: 'Left a voicemail, trying again tomorrow morning.',
      oldValue: null,
      newValue: null,
    },
    {
      id: `${leadId}-activity-created`,
      processInstanceId: process?.processInstanceId ?? null,
      // A system-authored row: the renderer must not print a blank actor.
      actorUserId: null,
      actorName: null,
      timestamp: at(9),
      actionType: 'field_edit',
      source: 'import',
      commentText: null,
      oldValue: null,
      newValue: { name: lead.name, fieldValues: lead.fieldValues },
    },
  ];
  return [...(MOCK_ACTIVITY[leadId] ?? []), ...seeded];
}
const MOCK_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'notification-synthetic',
    type: 'field_edited',
    message: 'A synthetic seller was updated',
    referenceLeadId: 'lead-1',
    read: false,
    readAt: null,
    createdAt: new Date().toISOString(),
  },
];
const MOCK_NOTIFICATION_RULES: unknown[] = [];
const MOCK_ROLES = USERS.map((user) => ({
  id: user.roleId,
  key: user.roleId.replaceAll('-', '_'),
  name: user.roleName,
  active: true,
  version: 1,
  permissions: user.permissions,
  journeyAccess: JOURNEYS.map((j) => ({ journeyId: j.id })),
  fieldVisibility: FIELDS.filter((f) => !user.restrictedFieldIds.includes(f.id)).map((f) => ({
    fieldId: f.id,
    accessLevel: 'EDIT',
  })),
}));
const MOCK_DEPARTMENTS = [
  {
    id: 'department-synthetic',
    key: 'synthetic_unit',
    name: 'Synthetic unit',
    active: true,
    version: 1,
  },
  {
    id: 'department-b',
    key: 'synthetic_unit_b',
    name: 'Synthetic unit B',
    active: true,
    version: 1,
  },
  {
    id: 'department-c',
    key: 'synthetic_unit_c',
    name: 'Synthetic unit C',
    active: true,
    version: 1,
  },
];
const MOCK_ADMIN_FIELDS = FIELDS.map((field) => ({
  id: field.id,
  key: field.key,
  name: field.label,
  fieldType: field.type,
  validationRule: field.options ? { options: [...field.options] } : null,
  section: null as string | null,
  editMode: 'manual',
  source: 'manual',
  active: true,
}));
const MOCK_ADMIN_USERS = [
  ...USERS.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    roleId: user.roleId,
    departmentId: null as string | null,
    managerId: null as string | null,
    active: true,
  })),
  ...DIRECTORY_USERS,
];
const MOCK_JOURNEY_FIELDS: Array<{
  fieldId: string;
  journeyId: string;
  requirement: string;
  requiredFromStatusId: string | null;
}> = [];

const INITIAL_ADMIN_STATE = structuredClone({
  journeys: JOURNEYS,
  statuses: STATUSES,
  roles: MOCK_ROLES,
  departments: MOCK_DEPARTMENTS,
  fields: MOCK_ADMIN_FIELDS,
  users: MOCK_ADMIN_USERS,
});

/**
 * Per-(field, journey) required-field rules, matching the shape of
 * field_journey_settings. Tests push rules onto this to exercise a rejected
 * status change; it starts empty so the default fixtures stay permissive.
 */
export const MOCK_REQUIRED_FIELD_RULES: Array<{
  fieldId: string;
  journeyId: string;
  requiredFromStatusId: string | null;
}> = [];

function isBlank(value: unknown): boolean {
  return (
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
  );
}

export function resetAdminMockState() {
  const initial = structuredClone(INITIAL_ADMIN_STATE);
  JOURNEYS.splice(0, JOURNEYS.length, ...initial.journeys);
  STATUSES.splice(0, STATUSES.length, ...initial.statuses);
  MOCK_ROLES.splice(0, MOCK_ROLES.length, ...initial.roles);
  MOCK_DEPARTMENTS.splice(0, MOCK_DEPARTMENTS.length, ...initial.departments);
  MOCK_ADMIN_FIELDS.splice(0, MOCK_ADMIN_FIELDS.length, ...initial.fields);
  MOCK_ADMIN_USERS.splice(0, MOCK_ADMIN_USERS.length, ...initial.users);
  MOCK_JOURNEY_FIELDS.splice(0);
  MOCK_REQUIRED_FIELD_RULES.splice(0);
}

function pageResponse<T>(request: Request, rows: T[]) {
  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page') ?? '1');
  const pageSize = Number(url.searchParams.get('pageSize') ?? '25');
  return {
    page,
    pageSize,
    total: rows.length,
    items: rows.slice((page - 1) * pageSize, page * pageSize),
  };
}

function errorBody(error: string, details?: Record<string, unknown>) {
  return { error, ...(details ? { details } : {}) };
}

function requireUser() {
  const userId = resolveUserId();
  return USERS.find((user) => user.id === userId);
}

function journeyName(journeyId: string): string {
  return JOURNEYS.find((journey) => journey.id === journeyId)?.name ?? 'Unknown Journey';
}

function statusFor(statusId: string) {
  return STATUSES.find((status) => status.id === statusId);
}

function serializeRow(lead: MockLead, user: ReturnType<typeof requireUser>) {
  if (!user) return null;
  const primary = lead.processInstances[0];
  const status = primary ? statusFor(primary.statusId) : undefined;
  const owner = primary?.assignments[0]
    ? USERS.find((candidate) => candidate.id === primary.assignments[0]?.userId)
    : undefined;

  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    fieldValues: stripFieldValues(lead.fieldValues, user),
    processInstances: primary
      ? [
          {
            processInstanceId: primary.processInstanceId,
            journeyId: primary.journeyId,
            journeyName: journeyName(primary.journeyId),
            statusId: primary.statusId,
            statusName: status?.name ?? 'Unknown',
            statusOutcomeType: status?.outcomeType ?? 'open',
            statusBehaviorType: status?.behaviorType ?? 'default',
            ownerName: owner?.name ?? null,
          },
        ]
      : [],
  };
}

function serializeDetail(lead: MockLead, user: ReturnType<typeof requireUser>) {
  if (!user) return null;
  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    fieldValues: stripFieldValues(lead.fieldValues, user),
    processInstances: lead.processInstances.map((process) => {
      const status = statusFor(process.statusId);
      return {
        processInstanceId: process.processInstanceId,
        journeyId: process.journeyId,
        active: process.active,
        journey: {
          id: process.journeyId,
          key: JOURNEYS.find((j) => j.id === process.journeyId)?.key ?? '',
          name: journeyName(process.journeyId),
        },
        currentStatus: {
          id: status?.id ?? '',
          key: status?.key ?? '',
          name: status?.name ?? 'Unknown',
          outcomeType: status?.outcomeType ?? 'open',
          behaviorType: status?.behaviorType ?? 'default',
        },
        assignments: process.assignments.map((assignment) => ({
          id: assignment.id,
          assignmentType: assignment.assignmentType,
          userId: assignment.userId,
          userName: USERS.find((u) => u.id === assignment.userId)?.name ?? 'Unknown',
        })),
      };
    }),
  };
}

export const handlers = [
  http.post(`${API_BASE}/auth/login`, async ({ request }) => {
    await delay(500);
    const body = (await request.json()) as {
      organizationId?: string;
      email?: string;
      password?: string;
    };

    if (!body.organizationId || !body.email || !body.password) {
      return HttpResponse.json(errorBody('validation_error'), { status: 400 });
    }

    const user = USERS.find(
      (candidate) => candidate.email.toLowerCase() === body.email?.toLowerCase(),
    );

    if (!user || user.password !== body.password || body.organizationId !== ORGANIZATION_ID) {
      return HttpResponse.json(errorBody('invalid_credentials'), { status: 401 });
    }

    const token = createSession(user.id);
    return HttpResponse.json(
      { userId: user.id },
      { status: 200, headers: { 'set-cookie': setCookieHeader(token) } },
    );
  }),

  http.post(`${API_BASE}/auth/logout`, async () => {
    await delay(150);
    destroySession(currentSessionToken());
    return new HttpResponse(null, { status: 204, headers: { 'set-cookie': clearCookieHeader() } });
  }),

  http.get(`${API_BASE}/auth/me`, async () => {
    await delay(200);
    const user = requireUser();
    if (!user) {
      return HttpResponse.json(errorBody('unauthenticated'), { status: 401 });
    }
    return HttpResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      roleId: user.roleId,
      roleName: user.roleName,
    });
  }),
  http.get(`${API_BASE}/auth/capabilities`, () => {
    const user = requireUser();
    if (!user) return HttpResponse.json(errorBody('unauthenticated'), { status: 401 });
    return HttpResponse.json({
      permissions: user.permissions,
      journeyIds: JOURNEYS.map((x) => x.id),
      fieldVisibility: FIELDS.filter((x) => !user.restrictedFieldIds.includes(x.id)).map((x) => ({
        fieldId: x.id,
        accessLevel: 'EDIT',
      })),
    });
  }),

  http.get(`${API_BASE}/journeys`, async ({ request }) => {
    await delay(250);
    if (!requireUser()) return HttpResponse.json(errorBody('unauthenticated'), { status: 401 });
    const active = new URL(request.url).searchParams.get('active');
    const rows = JOURNEYS.filter(
      (journey) => active === null || journey.isActive === (active === 'true'),
    ).map((journey) => ({
      ...journey,
      active: journey.isActive,
      statuses: STATUSES.filter((status) => status.journeyId === journey.id).sort(
        (a, b) => a.sortOrder - b.sortOrder,
      ),
    }));
    // The API always returns a Page here. Returning a bare array when the
    // caller omitted pageSize used to make configApi.journeys() resolve to
    // undefined, which silently emptied the journey tabs.
    return HttpResponse.json(pageResponse(request, rows));
  }),
  http.get(`${API_BASE}/journeys/:id`, ({ params }) => {
    const journey = JOURNEYS.find((row) => row.id === params.id);
    return journey
      ? HttpResponse.json({
          ...journey,
          active: journey.isActive,
          // Serialized the way Prisma emits it (`active`, not `isActive`) so the
          // client's normalizer is exercised against the real DTO.
          statuses: STATUSES.filter((status) => status.journeyId === journey.id)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map(({ isActive, ...status }) => ({ ...status, active: isActive })),
          // Distinct assignment types actually in use on this journey, matching
          // the API's derivation from current assignments.
          assignmentTypes: [
            ...new Set(
              LEADS.flatMap((lead) =>
                lead.processInstances
                  .filter((process) => process.journeyId === journey.id)
                  .flatMap((process) =>
                    process.assignments.map((assignment) => assignment.assignmentType),
                  ),
              ),
            ),
          ].sort(),
        })
      : HttpResponse.json(errorBody('not_found'), { status: 404 });
  }),
  http.post(`${API_BASE}/journeys`, async ({ request }) => {
    const body = (await request.json()) as { key: string; name: string };
    const row = { id: `journey-${Date.now()}`, key: body.key, name: body.name, isActive: true };
    JOURNEYS.push(row);
    return HttpResponse.json({ ...row, active: true, statuses: [] }, { status: 201 });
  }),
  http.patch(`${API_BASE}/journeys/:id`, async ({ params, request }) => {
    const body = (await request.json()) as { name: string };
    const row = JOURNEYS.find((journey) => journey.id === params.id);
    if (!row) return HttpResponse.json(errorBody('not_found'), { status: 404 });
    row.name = body.name;
    return HttpResponse.json({ ...row, active: row.isActive });
  }),
  http.delete(`${API_BASE}/journeys/:id`, ({ params }) => {
    const row = JOURNEYS.find((journey) => journey.id === params.id);
    if (!row) return HttpResponse.json(errorBody('not_found'), { status: 404 });
    row.isActive = false;
    return HttpResponse.json({ ...row, active: false });
  }),

  // No GET /journeys/:id/statuses handler on purpose: the API registers only
  // POST for that path. Mocking the GET let a client call that 404s in
  // production pass every test. Statuses come from GET /journeys/:id.
  http.post(`${API_BASE}/journeys/:id/statuses`, async ({ params, request }) => {
    const body = (await request.json()) as Omit<
      (typeof STATUSES)[number],
      'id' | 'journeyId' | 'isActive'
    >;
    const row = {
      ...body,
      id: `status-${Date.now()}`,
      journeyId: String(params.id),
      isActive: true,
    };
    STATUSES.push(row);
    return HttpResponse.json(row, { status: 201 });
  }),
  http.patch(`${API_BASE}/statuses/:id`, async ({ params, request }) => {
    const body = (await request.json()) as Partial<(typeof STATUSES)[number]>;
    const row = STATUSES.find((status) => status.id === params.id);
    if (!row) return HttpResponse.json(errorBody('not_found'), { status: 404 });
    Object.assign(row, body);
    return HttpResponse.json(row);
  }),
  http.delete(`${API_BASE}/statuses/:id`, ({ params }) => {
    const row = STATUSES.find((status) => status.id === params.id);
    if (!row) return HttpResponse.json(errorBody('not_found'), { status: 404 });
    row.isActive = false;
    return HttpResponse.json(row);
  }),
  http.put(`${API_BASE}/journeys/:id/status-order`, async ({ params, request }) => {
    const body = (await request.json()) as { statusIds: string[] };
    body.statusIds.forEach((id, sortOrder) => {
      const row = STATUSES.find((status) => status.id === id && status.journeyId === params.id);
      if (row) row.sortOrder = sortOrder;
    });
    return HttpResponse.json(
      body.statusIds.map((id) => STATUSES.find((status) => status.id === id)).filter(Boolean),
    );
  }),
  http.get(`${API_BASE}/journeys/:id/fields`, ({ params }) =>
    HttpResponse.json(
      MOCK_JOURNEY_FIELDS.filter((setting) => setting.journeyId === params.id).map((setting) => ({
        ...setting,
        field: MOCK_ADMIN_FIELDS.find((field) => field.id === setting.fieldId),
      })),
    ),
  ),
  http.put(`${API_BASE}/journeys/:id/fields/:fieldId`, async ({ params, request }) => {
    const body = (await request.json()) as {
      requirement: string;
      requiredFromStatusId: string | null;
    };
    const existing = MOCK_JOURNEY_FIELDS.find(
      (setting) => setting.journeyId === params.id && setting.fieldId === params.fieldId,
    );
    const value = {
      journeyId: String(params.id),
      fieldId: String(params.fieldId),
      requirement: body.requirement,
      requiredFromStatusId: body.requiredFromStatusId,
    };
    if (existing) Object.assign(existing, value);
    else MOCK_JOURNEY_FIELDS.push(value);
    return HttpResponse.json(value);
  }),
  http.delete(`${API_BASE}/journeys/:id/fields/:fieldId`, ({ params }) => {
    const index = MOCK_JOURNEY_FIELDS.findIndex(
      (setting) => setting.journeyId === params.id && setting.fieldId === params.fieldId,
    );
    if (index < 0) return HttpResponse.json(errorBody('not_found'), { status: 404 });
    const [row] = MOCK_JOURNEY_FIELDS.splice(index, 1);
    return HttpResponse.json(row);
  }),

  http.get(`${API_BASE}/fields`, async ({ request }) => {
    await delay(200);
    const user = requireUser();
    if (!user) return HttpResponse.json(errorBody('unauthenticated'), { status: 401 });
    // Always a Page of API-shaped rows (`name`/`fieldType`), matching what
    // readConfiguration actually serializes.
    return HttpResponse.json(
      pageResponse(
        request,
        MOCK_ADMIN_FIELDS.filter((field) => !user.restrictedFieldIds.includes(field.id)),
      ),
    );
  }),
  http.post(`${API_BASE}/fields`, async ({ request }) => {
    const body = (await request.json()) as Omit<
      (typeof MOCK_ADMIN_FIELDS)[number],
      'id' | 'active'
    >;
    const row = { ...body, id: `field-${Date.now()}`, active: true };
    MOCK_ADMIN_FIELDS.push(row);
    return HttpResponse.json(row, { status: 201 });
  }),
  http.patch(`${API_BASE}/fields/:id`, async ({ params, request }) => {
    const body = (await request.json()) as Partial<(typeof MOCK_ADMIN_FIELDS)[number]>;
    const row = MOCK_ADMIN_FIELDS.find((field) => field.id === params.id);
    if (!row) return HttpResponse.json(errorBody('not_found'), { status: 404 });
    Object.assign(row, body);
    return HttpResponse.json(row);
  }),
  http.delete(`${API_BASE}/fields/:id`, ({ params }) => {
    const row = MOCK_ADMIN_FIELDS.find((field) => field.id === params.id);
    if (!row) return HttpResponse.json(errorBody('not_found'), { status: 404 });
    row.active = false;
    return HttpResponse.json(row);
  }),

  http.get(`${API_BASE}/services`, async () => {
    await delay(200);
    if (!requireUser()) return HttpResponse.json(errorBody('unauthenticated'), { status: 401 });
    return HttpResponse.json(SERVICES);
  }),
  http.get(`${API_BASE}/permissions/catalog`, () =>
    HttpResponse.json({
      modules: [
        {
          module: 'users',
          label: 'Users & Departments',
          actions: ['view', 'create', 'edit', 'deactivate'],
        },
        {
          module: 'roles_permissions',
          label: 'Roles & Permissions',
          actions: ['view', 'create', 'edit'],
        },
        { module: 'fields', label: 'Fields', actions: ['view', 'create', 'edit', 'delete'] },
        {
          module: 'journeys_statuses',
          label: 'Journeys & Statuses',
          actions: ['view', 'create', 'edit', 'delete'],
        },
      ],
      supportedScopes: ['SELF', 'TEAM', 'DEPARTMENT', 'ORGANIZATION'],
    }),
  ),
  http.get(`${API_BASE}/roles`, ({ request }) =>
    HttpResponse.json(pageResponse(request, MOCK_ROLES)),
  ),
  http.get(`${API_BASE}/roles/:id`, ({ params }) => {
    const row = MOCK_ROLES.find((x) => x.id === params.id);
    return row
      ? HttpResponse.json(row)
      : HttpResponse.json(errorBody('not_found'), { status: 404 });
  }),
  http.post(`${API_BASE}/roles`, async ({ request }) => {
    const body = (await request.json()) as { key: string; name: string };
    const row = {
      id: `role-${Date.now()}`,
      key: body.key,
      name: body.name,
      active: true,
      version: 1,
      permissions: [],
      journeyAccess: [],
      fieldVisibility: [],
    };
    MOCK_ROLES.push(row);
    return HttpResponse.json(row, { status: 201 });
  }),
  http.put(`${API_BASE}/roles/:id`, async ({ params, request }) => {
    const body = (await request.json()) as { name: string };
    const row = MOCK_ROLES.find((role) => role.id === params.id);
    if (!row) return HttpResponse.json(errorBody('not_found'), { status: 404 });
    row.name = body.name;
    return HttpResponse.json(row);
  }),
  http.post(`${API_BASE}/roles/:id/deactivate`, async ({ params, request }) => {
    const body = (await request.json()) as { replacementRoleId?: string };
    const row = MOCK_ROLES.find((role) => role.id === params.id);
    if (!row) return HttpResponse.json(errorBody('not_found'), { status: 404 });
    const assigned = MOCK_ADMIN_USERS.filter((user) => user.active && user.roleId === row.id);
    if (assigned.length && !body.replacementRoleId)
      return HttpResponse.json(errorBody('conflict'), { status: 409 });
    assigned.forEach((user) => {
      user.roleId = body.replacementRoleId as string;
    });
    row.active = false;
    return HttpResponse.json(row);
  }),
  http.get(`${API_BASE}/users`, ({ request }) => {
    const url = new URL(request.url);
    const roleId = url.searchParams.get('roleId');
    const departmentId = url.searchParams.get('departmentId');
    const active = url.searchParams.get('active');
    const search = url.searchParams.get('search')?.toLowerCase();
    const rows = MOCK_ADMIN_USERS.filter(
      (user) =>
        (!roleId || user.roleId === roleId) &&
        (!departmentId || user.departmentId === departmentId) &&
        (active === null || user.active === (active === 'true')) &&
        (!search ||
          user.name.toLowerCase().includes(search) ||
          user.email.toLowerCase().includes(search)),
    );
    return HttpResponse.json(pageResponse(request, rows));
  }),
  http.post(`${API_BASE}/users`, async ({ request }) => {
    const body = (await request.json()) as Omit<(typeof MOCK_ADMIN_USERS)[number], 'id' | 'active'>;
    if ('password' in body)
      return HttpResponse.json(errorBody('validation_error'), { status: 400 });
    const row = { ...body, id: `user-${Date.now()}`, active: true };
    MOCK_ADMIN_USERS.push(row);
    return HttpResponse.json(row, { status: 201 });
  }),
  http.put(`${API_BASE}/users/:id`, async ({ params, request }) => {
    const body = (await request.json()) as Partial<(typeof MOCK_ADMIN_USERS)[number]>;
    const row = MOCK_ADMIN_USERS.find((user) => user.id === params.id);
    if (!row) return HttpResponse.json(errorBody('not_found'), { status: 404 });
    Object.assign(row, body);
    return HttpResponse.json(row);
  }),
  http.post(`${API_BASE}/users/:id/deactivate`, ({ params }) => {
    const row = MOCK_ADMIN_USERS.find((user) => user.id === params.id);
    if (!row) return HttpResponse.json(errorBody('not_found'), { status: 404 });
    row.active = false;
    return HttpResponse.json(row);
  }),
  http.get(`${API_BASE}/departments`, ({ request }) =>
    HttpResponse.json(pageResponse(request, MOCK_DEPARTMENTS)),
  ),
  http.post(`${API_BASE}/departments`, async ({ request }) => {
    const body = (await request.json()) as { key: string; name: string };
    const row = {
      id: `department-${Date.now()}`,
      key: body.key,
      name: body.name,
      active: true,
      version: 1,
    };
    MOCK_DEPARTMENTS.push(row);
    return HttpResponse.json(row, { status: 201 });
  }),
  http.put(`${API_BASE}/departments/:id`, async ({ params, request }) => {
    const body = (await request.json()) as { name: string };
    const row = MOCK_DEPARTMENTS.find((department) => department.id === params.id);
    if (!row) return HttpResponse.json(errorBody('not_found'), { status: 404 });
    row.name = body.name;
    return HttpResponse.json(row);
  }),
  http.put(`${API_BASE}/roles/:id/permissions`, async ({ params, request }) => {
    const body = (await request.json()) as {
      permissions: (typeof MOCK_ROLES)[number]['permissions'];
    };
    const row = MOCK_ROLES.find((role) => role.id === params.id);
    if (row) row.permissions = body.permissions;
    return HttpResponse.json(body.permissions);
  }),
  http.put(`${API_BASE}/roles/:id/journey-access`, async ({ params, request }) => {
    const body = (await request.json()) as { journeyIds: string[] };
    const row = MOCK_ROLES.find((role) => role.id === params.id);
    if (row) row.journeyAccess = body.journeyIds.map((journeyId) => ({ journeyId }));
    return HttpResponse.json(body.journeyIds);
  }),
  http.put(`${API_BASE}/roles/:id/field-visibility`, async ({ params, request }) => {
    const body = (await request.json()) as {
      fieldVisibility: (typeof MOCK_ROLES)[number]['fieldVisibility'];
    };
    const row = MOCK_ROLES.find((role) => role.id === params.id);
    if (row) row.fieldVisibility = body.fieldVisibility;
    return HttpResponse.json(body.fieldVisibility);
  }),

  http.get(`${API_BASE}/leads`, async ({ request }) => {
    await delay(550);
    const user = requireUser();
    if (!user) return HttpResponse.json(errorBody('unauthenticated'), { status: 401 });

    const url = new URL(request.url);
    const search = url.searchParams.get('search')?.toLowerCase().trim();
    const journeyId = url.searchParams.get('journeyId') ?? undefined;
    const statusId = url.searchParams.get('statusId') ?? undefined;
    const sortBy = url.searchParams.get('sortBy') ?? 'updatedAt';
    const sortDirection = url.searchParams.get('sortDirection') ?? 'desc';
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '10');

    let scoped = LEADS.filter((lead) => isLeadInScope(lead, user));

    if (journeyId) {
      scoped = scoped.filter((lead) =>
        lead.processInstances.some((p) => p.journeyId === journeyId),
      );
    }
    if (statusId) {
      scoped = scoped.filter((lead) => lead.processInstances.some((p) => p.statusId === statusId));
    }
    if (search) {
      scoped = scoped.filter(
        (lead) =>
          lead.name.toLowerCase().includes(search) ||
          lead.phone.toLowerCase().includes(search) ||
          lead.email.toLowerCase().includes(search),
      );
    }

    scoped = [...scoped].sort((a, b) => {
      const direction = sortDirection === 'asc' ? 1 : -1;
      if (sortBy === 'name') return a.name.localeCompare(b.name) * direction;
      return (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) * direction;
    });

    const total = scoped.length;
    const start = (page - 1) * pageSize;
    const rows = scoped
      .slice(start, start + pageSize)
      .map((lead) => serializeRow(lead, user))
      .filter((row): row is NonNullable<typeof row> => row !== null);

    return HttpResponse.json({ total, rows });
  }),

  http.get(`${API_BASE}/leads/:id`, async ({ params }) => {
    await delay(400);
    const user = requireUser();
    if (!user) return HttpResponse.json(errorBody('unauthenticated'), { status: 401 });

    const lead = LEADS.find((candidate) => candidate.id === params.id);
    if (!lead || !isLeadInScope(lead, user)) {
      return HttpResponse.json(errorBody('not_found'), { status: 404 });
    }
    return HttpResponse.json(serializeDetail(lead, user));
  }),

  http.post(`${API_BASE}/leads`, async ({ request }) => {
    await delay(600);
    const user = requireUser();
    if (!user) return HttpResponse.json(errorBody('unauthenticated'), { status: 401 });

    const body = (await request.json()) as {
      journeyId?: string;
      statusId?: string;
      name?: string;
      phone?: string | null;
      email?: string | null;
      fieldValues?: Record<string, unknown>;
      assignments?: ReadonlyArray<{ assignmentType: string; userId: string }>;
    };

    if (!body.journeyId || !body.name || !body.assignments?.length) {
      return HttpResponse.json(
        errorBody('validation_error', { fields: ['journeyId', 'name', 'assignments'] }),
        { status: 400 },
      );
    }

    const journeyStatuses = STATUSES.filter((status) => status.journeyId === body.journeyId);
    const defaultStatus = journeyStatuses.find((s) => s.key === 'new') ?? journeyStatuses[0];
    const statusId = body.statusId ?? defaultStatus?.id ?? '';

    const id = `lead-${LEADS.length + 1}`;
    const now = new Date().toISOString();
    const lead: MockLead = {
      id,
      organizationId: ORGANIZATION_ID,
      name: body.name,
      phone: body.phone ?? '',
      email: body.email ?? '',
      fieldValues: { ...body.fieldValues },
      createdAt: now,
      updatedAt: now,
      processInstances: [
        {
          processInstanceId: `pi-${id}`,
          journeyId: body.journeyId,
          statusId,
          active: true,
          assignments: body.assignments.map((assignment, index) => ({
            id: `assign-${id}-${index}`,
            assignmentType: assignment.assignmentType,
            userId: assignment.userId,
          })),
        },
      ],
    };
    LEADS.unshift(lead);

    // The API returns the raw rows, not a serialized record. Mirroring that
    // here is what makes `created.lead.id` the correct thing for callers to read.
    return HttpResponse.json(
      {
        lead: { id: lead.id, name: lead.name },
        process: { id: `pi-${id}`, journeyId: body.journeyId, currentStatusId: statusId },
      },
      { status: 201 },
    );
  }),

  http.patch(`${API_BASE}/leads/:id`, async ({ request, params }) => {
    await delay(500);
    const user = requireUser();
    if (!user) return HttpResponse.json(errorBody('unauthenticated'), { status: 401 });

    const lead = LEADS.find((candidate) => candidate.id === params.id);
    if (!lead || !isLeadInScope(lead, user)) {
      return HttpResponse.json(errorBody('not_found'), { status: 404 });
    }

    const body = (await request.json()) as {
      name?: string;
      phone?: string | null;
      email?: string | null;
      fieldValues?: Record<string, unknown>;
      statusId?: string;
      processInstanceId?: string;
      assignmentTypes?: string[];
    };

    /*
     * Mirrors assignmentScopeAllowsLead in the permission engine: a scope
     * narrower than ORGANIZATION only matches a record through a current
     * assignment whose type is in the caller's assignmentTypes. Sending none
     * therefore matches nothing and is refused — which is exactly how a client
     * that omits the field silently 403s in production.
     */
    if (user.dataScope !== 'ORGANIZATION') {
      const requested = new Set(body.assignmentTypes ?? []);
      const matches = lead.processInstances.some((process) =>
        process.assignments.some(
          (assignment) => assignment.userId === user.id && requested.has(assignment.assignmentType),
        ),
      );
      if (!matches) return HttpResponse.json(errorBody('forbidden'), { status: 403 });
    }

    if (body.name !== undefined) lead.name = body.name;
    if (body.phone !== undefined) lead.phone = body.phone ?? '';
    if (body.email !== undefined) lead.email = body.email ?? '';
    if (body.fieldValues) lead.fieldValues = { ...lead.fieldValues, ...body.fieldValues };
    lead.updatedAt = new Date().toISOString();

    const process =
      lead.processInstances.find((p) => p.processInstanceId === body.processInstanceId) ??
      lead.processInstances[0];
    if (process && body.statusId) {
      const nextStatus = statusFor(body.statusId);
      if (!nextStatus || nextStatus.journeyId !== process.journeyId) {
        return HttpResponse.json(errorBody('validation_error', { field: 'statusId' }), {
          status: 400,
        });
      }

      /*
       * Mirrors validateFieldValues in apps/api: a field is required when its
       * requirement is 'required' and requiredFromStatusId is either null or an
       * exact match for the *target* status. sortOrder plays no part.
       * Only the first offender is reported, exactly as the API does.
       */
      const missing = MOCK_REQUIRED_FIELD_RULES.find(
        (rule) =>
          rule.journeyId === process.journeyId &&
          (rule.requiredFromStatusId === null || rule.requiredFromStatusId === body.statusId) &&
          isBlank(lead.fieldValues[rule.fieldId]),
      );
      if (missing) {
        return HttpResponse.json(errorBody('validation_error', { fieldId: missing.fieldId }), {
          status: 400,
        });
      }

      process.statusId = body.statusId;
      process.active = nextStatus.outcomeType === 'open';
    }

    // The API returns the raw rows here, not a serialized record.
    return HttpResponse.json({
      lead: { id: lead.id, name: lead.name },
      process: {
        id: process?.processInstanceId ?? '',
        journeyId: process?.journeyId ?? '',
        currentStatusId: process?.statusId ?? '',
      },
    });
  }),
  http.get(`${API_BASE}/leads/:id/activity`, ({ params }) => {
    const items = activityFor(String(params.id));
    return HttpResponse.json({ page: 1, pageSize: 25, total: items.length, items });
  }),
  http.post(`${API_BASE}/leads/:id/comments`, async ({ request, params }) => {
    const body = (await request.json()) as { text: string };
    if (!body.text.trim()) return HttpResponse.json(errorBody('validation_error'), { status: 400 });
    const entry = {
      id: `activity-comment-${Date.now()}`,
      processInstanceId: null,
      actorUserId: USERS[0]!.id,
      actorName: USERS[0]!.name,
      timestamp: new Date().toISOString(),
      actionType: 'comment',
      source: 'lead_api',
      commentText: body.text.trim(),
      oldValue: null,
      newValue: null,
    };
    (MOCK_ACTIVITY[String(params.id)] ??= []).unshift(entry);
    return HttpResponse.json(entry, { status: 201 });
  }),
  http.patch(`${API_BASE}/leads/:id/reassign`, async ({ request, params }) => {
    const body = (await request.json()) as { assignmentType: string; userId: string };
    const user = USERS.find((candidate) => candidate.id === body.userId);
    if (!user) return HttpResponse.json(errorBody('not_found'), { status: 404 });
    (MOCK_ACTIVITY[String(params.id)] ??= []).unshift({
      id: `activity-reassign-${Date.now()}`,
      processInstanceId: null,
      actorUserId: USERS[0]!.id,
      actorName: USERS[0]!.name,
      timestamp: new Date().toISOString(),
      actionType: 'reassignment',
      source: 'lead_api',
      commentText: null,
      oldValue: { assignmentType: body.assignmentType },
      newValue: { assignmentType: body.assignmentType, userId: body.userId },
    });
    return HttpResponse.json({ ok: true });
  }),
  http.post(`${API_BASE}/leads/:id/deactivate`, ({ params }) => {
    (MOCK_ACTIVITY[String(params.id)] ??= []).unshift({
      id: `activity-deactivate-${Date.now()}`,
      processInstanceId: null,
      actorUserId: USERS[0]!.id,
      actorName: USERS[0]!.name,
      timestamp: new Date().toISOString(),
      actionType: 'lead_deactivated',
      source: 'lead_api',
      commentText: null,
      oldValue: null,
      newValue: null,
    });
    return HttpResponse.json({ ok: true });
  }),
  http.get(`${API_BASE}/leads/:id/attachments`, ({ params }) =>
    HttpResponse.json({
      items: MOCK_ATTACHMENTS.filter((row) => row.leadId === String(params.id)),
    }),
  ),
  http.post(`${API_BASE}/leads/:id/attachments`, async ({ request, params }) => {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return HttpResponse.json(errorBody('validation_error'), { status: 400 });
    }
    // FormDataEntryValue is string | File; only a string is a usable name.
    const nameEntry = form.get('name');
    const name = (typeof nameEntry === 'string' ? nameEntry.trim() : '') || file.name;
    const record: MockAttachment = {
      id: `attachment-${Date.now()}`,
      leadId: String(params.id),
      fileName: name,
      mimeType: file.type || null,
      sizeBytes: file.size,
      uploadedById: USERS[0]!.id,
      uploadedByName: USERS[0]!.name,
      uploadedAt: new Date().toISOString(),
    };
    MOCK_ATTACHMENTS.unshift(record);
    return HttpResponse.json(record, { status: 201 });
  }),
  http.delete(`${API_BASE}/attachments/:attachmentId`, ({ params }) => {
    const index = MOCK_ATTACHMENTS.findIndex((row) => row.id === params.attachmentId);
    if (index >= 0) MOCK_ATTACHMENTS.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),
  http.get(`${API_BASE}/leads/:id/shares`, ({ params }) =>
    HttpResponse.json(MOCK_SHARES.filter((s) => s.leadId === params.id)),
  ),
  http.post(`${API_BASE}/leads/:id/shares`, async ({ request, params }) => {
    const body = (await request.json()) as { userId: string; capabilities: string[] };
    const user = USERS.find((u) => u.id === body.userId);
    const share = {
      id: `share-${Date.now()}`,
      leadId: String(params.id),
      userId: body.userId,
      userName: user?.name ?? 'Synthetic user',
      grantedByUserId: USERS[0]!.id,
      capabilities: body.capabilities,
      createdAt: new Date().toISOString(),
    };
    MOCK_SHARES.push(share);
    return HttpResponse.json(share, { status: 201 });
  }),
  http.delete(`${API_BASE}/leads/:id/shares/:shareId`, ({ params }) => {
    const i = MOCK_SHARES.findIndex((s) => s.id === params.shareId);
    if (i >= 0) MOCK_SHARES.splice(i, 1);
    return new HttpResponse(null, { status: 204 });
  }),
  http.put(`${API_BASE}/leads/:id/shares/:shareId`, async ({ request, params }) => {
    const row = MOCK_SHARES.find((share) => share.id === params.shareId);
    if (!row) return HttpResponse.json(errorBody('not_found'), { status: 404 });
    const body = (await request.json()) as { capabilities: string[] };
    row.capabilities = body.capabilities;
    return HttpResponse.json(row);
  }),
  http.get(`${API_BASE}/notifications/unread-count`, () =>
    HttpResponse.json({ count: MOCK_NOTIFICATIONS.filter((n) => !n.read).length }),
  ),
  http.get(`${API_BASE}/notifications`, () =>
    HttpResponse.json({ total: MOCK_NOTIFICATIONS.length, items: MOCK_NOTIFICATIONS }),
  ),
  http.patch(`${API_BASE}/notifications/:id/read`, ({ params }) => {
    const row = MOCK_NOTIFICATIONS.find((n) => n.id === params.id);
    if (row) {
      row.read = true;
      row.readAt = new Date().toISOString();
    }
    return row
      ? HttpResponse.json(row)
      : HttpResponse.json(errorBody('not_found'), { status: 404 });
  }),
  http.get(`${API_BASE}/notification-rules`, () =>
    HttpResponse.json({ total: MOCK_NOTIFICATION_RULES.length, items: MOCK_NOTIFICATION_RULES }),
  ),
  http.post(`${API_BASE}/notification-rules`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const row = { id: `rule-${Date.now()}`, active: true, version: 1, ...body };
    MOCK_NOTIFICATION_RULES.push(row);
    return HttpResponse.json(row, { status: 201 });
  }),
];
