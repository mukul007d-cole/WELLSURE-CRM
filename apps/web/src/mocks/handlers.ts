import { http, HttpResponse, delay } from 'msw';
import {
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

const API_BASE = '/api/v1';
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
const MOCK_ADMIN_USERS = USERS.map((user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  roleId: user.roleId,
  departmentId: null as string | null,
  managerId: null as string | null,
  active: true,
}));
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

export function resetAdminMockState() {
  const initial = structuredClone(INITIAL_ADMIN_STATE);
  JOURNEYS.splice(0, JOURNEYS.length, ...initial.journeys);
  STATUSES.splice(0, STATUSES.length, ...initial.statuses);
  MOCK_ROLES.splice(0, MOCK_ROLES.length, ...initial.roles);
  MOCK_DEPARTMENTS.splice(0, MOCK_DEPARTMENTS.length, ...initial.departments);
  MOCK_ADMIN_FIELDS.splice(0, MOCK_ADMIN_FIELDS.length, ...initial.fields);
  MOCK_ADMIN_USERS.splice(0, MOCK_ADMIN_USERS.length, ...initial.users);
  MOCK_JOURNEY_FIELDS.splice(0);
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
    return new URL(request.url).searchParams.has('pageSize')
      ? HttpResponse.json(pageResponse(request, rows))
      : HttpResponse.json(JOURNEYS);
  }),
  http.get(`${API_BASE}/journeys/:id`, ({ params }) => {
    const journey = JOURNEYS.find((row) => row.id === params.id);
    return journey
      ? HttpResponse.json({
          ...journey,
          active: journey.isActive,
          statuses: STATUSES.filter((status) => status.journeyId === journey.id).sort(
            (a, b) => a.sortOrder - b.sortOrder,
          ),
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

  http.get(`${API_BASE}/journeys/:id/statuses`, async ({ params }) => {
    await delay(250);
    if (!requireUser()) return HttpResponse.json(errorBody('unauthenticated'), { status: 401 });
    return HttpResponse.json(STATUSES.filter((status) => status.journeyId === params.id));
  }),
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
    const visible = FIELDS.filter((field) => !user.restrictedFieldIds.includes(field.id));
    return new URL(request.url).searchParams.has('pageSize')
      ? HttpResponse.json(
          pageResponse(
            request,
            MOCK_ADMIN_FIELDS.filter((field) => !user.restrictedFieldIds.includes(field.id)),
          ),
        )
      : HttpResponse.json(visible);
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

    return HttpResponse.json(serializeDetail(lead, user), { status: 201 });
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
    };

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
      process.statusId = body.statusId;
      process.active = nextStatus.outcomeType === 'open';
    }

    return HttpResponse.json(serializeDetail(lead, user));
  }),
];
