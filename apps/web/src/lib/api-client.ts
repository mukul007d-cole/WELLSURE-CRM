import { ApiError } from './api-error';
import type {
  CreateLeadInput,
  EditLeadInput,
  FieldDefinition,
  FieldValidationRule,
  Journey,
  LeadMutationResult,
  Seller360Record,
  SellerListInput,
  SellerListResponse,
  Service,
  SessionUser,
  Status,
  CapabilitySet,
  Page,
  PurgeResult,
  AdminJourney,
  AdminField,
  FieldRoleVisibility,
  AdminUser,
  AdminRole,
  Department,
  PermissionCatalog,
  ActivityEntry,
  AttachmentRecord,
  LeadShare,
  ShareCapability,
  NotificationItem,
  NotificationRule,
  Campaign,
  Team,
  TeamMember,
  RoutingGrant,
  RoutingRule,
  RoutingState,
  ImportAnalysis,
  ImportMapping,
  ImportRunResult,
} from '../types/domain';

const API_BASE = '/api/v1';
export const ADMIN_PAGE_SIZE = 25;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const body: unknown = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body as { error: string; details?: Record<string, unknown> },
    );
  }

  return body as T;
}

/**
 * Upload a file.
 *
 * Separate from `request` because that one sets `content-type: application/json`
 * on any body — and for a FormData body the browser must set the header itself,
 * since only it knows the multipart boundary.
 */
async function requestMultipart<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body as { error: string; details?: Record<string, unknown> },
    );
  }
  return body as T;
}

/**
 * Fetch binary content. `request` always calls `response.json()`, which would
 * throw on a document, and parses away the filename header we need.
 */
async function requestBlob(path: string): Promise<{ blob: Blob; fileName: string | null }> {
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      body as { error: string; details?: Record<string, unknown> },
    );
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  // Attachments send the RFC 5987 form; the export sends a plain quoted name.
  const plain = /filename="([^"]+)"/i.exec(disposition)?.[1];
  return {
    blob: await response.blob(),
    fileName: encoded ? decodeURIComponent(encoded) : (plain ?? null),
  };
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      query.set(key, String(value));
    }
  }
  const stringified = query.toString();
  return stringified ? `?${stringified}` : '';
}

export const authApi = {
  login: (organizationId: string, email: string, password: string) =>
    request<{ userId: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ organizationId, email, password }),
    }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<SessionUser>('/auth/me'),
  capabilities: () => request<CapabilitySet>('/auth/capabilities'),
};

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
/**
 * Bounded hard-delete (ADR-0017). Distinct from every `deactivate*` call above:
 * these remove the row, and nothing brings it back.
 *
 * `POST /<entity>/:id/purge` throughout, matching how the other non-idempotent
 * state changes are spelled. A `409 dependency_conflict` carries the blocking
 * relationships and their counts in `details`, which `PurgeDialog` renders.
 */
const purgeCalls = {
  purgeJourney: (id: string) => request<PurgeResult>(`/journeys/${id}/purge`, json('POST', {})),
  purgeStatus: (id: string) => request<PurgeResult>(`/statuses/${id}/purge`, json('POST', {})),
  purgeField: (id: string) => request<PurgeResult>(`/fields/${id}/purge`, json('POST', {})),
  purgeService: (id: string) => request<PurgeResult>(`/services/${id}/purge`, json('POST', {})),
  purgeTeam: (id: string) => request<PurgeResult>(`/teams/${id}/purge`, json('POST', {})),
  purgeRole: (id: string) => request<PurgeResult>(`/roles/${id}/purge`, json('POST', {})),
  purgeNotificationRule: (id: string) =>
    request<PurgeResult>(`/notification-rules/${id}/purge`, json('POST', {})),
};

export const adminApi = {
  journeys: (page = 1, active?: boolean, pageSize = ADMIN_PAGE_SIZE) =>
    request<Page<AdminJourney>>(
      `/journeys${toQuery({ page, pageSize, active: active === undefined ? undefined : String(active) })}`,
    ),
  journey: (id: string) => request<AdminJourney>(`/journeys/${id}`),
  createJourney: (body: { key: string; name: string }) =>
    request<AdminJourney>('/journeys', json('POST', body)),
  editJourney: (id: string, body: { name: string }) =>
    request<AdminJourney>(`/journeys/${id}`, json('PATCH', body)),
  deactivateJourney: (id: string) => request<AdminJourney>(`/journeys/${id}`, json('DELETE')),
  createStatus: (journeyId: string, body: object) =>
    request<Status>(`/journeys/${journeyId}/statuses`, json('POST', body)),
  editStatus: (id: string, body: object) => request<Status>(`/statuses/${id}`, json('PATCH', body)),
  deactivateStatus: (id: string, body: { journeyId: string; replacementStatusId?: string }) =>
    request<Status>(`/statuses/${id}`, json('DELETE', body)),
  reorderStatuses: (journeyId: string, statusIds: string[]) =>
    request<Status[]>(`/journeys/${journeyId}/status-order`, json('PUT', { statusIds })),
  journeyFields: (journeyId: string) =>
    request<
      Array<{
        fieldId: string;
        journeyId: string;
        requirement: string;
        requiredFromStatusId: string | null;
        field: AdminField;
      }>
    >(`/journeys/${journeyId}/fields`),
  setJourneyField: (journeyId: string, fieldId: string, body: object) =>
    request(`/journeys/${journeyId}/fields/${fieldId}`, json('PUT', body)),
  unmapJourneyField: (journeyId: string, fieldId: string) =>
    request(`/journeys/${journeyId}/fields/${fieldId}`, json('DELETE')),
  fields: (page = 1, active?: boolean, pageSize = ADMIN_PAGE_SIZE) =>
    request<Page<AdminField>>(
      `/fields${toQuery({ page, pageSize, active: active === undefined ? undefined : String(active) })}`,
    ),
  createField: (body: object) => request<AdminField>('/fields', json('POST', body)),
  editField: (id: string, body: object) =>
    request<AdminField>(`/fields/${id}`, json('PATCH', body)),
  deactivateField: (id: string) => request<AdminField>(`/fields/${id}`, json('DELETE')),
  // The Field side of field_visibility. One request carries the Field's whole
  // role set — never a per-role loop, which is how the role-side axis is saved
  // too.
  fieldRoleVisibility: (fieldId: string) =>
    request<FieldRoleVisibility[]>(`/fields/${fieldId}/visibility`),
  saveFieldRoleVisibility: (fieldId: string, visibility: FieldRoleVisibility[]) =>
    request<FieldRoleVisibility[]>(`/fields/${fieldId}/visibility`, json('PUT', { visibility })),
  users: (
    query: {
      page?: number;
      pageSize?: number;
      roleId?: string;
      departmentId?: string;
      active?: boolean;
      search?: string;
    } = {},
  ) =>
    request<Page<AdminUser>>(
      `/users${toQuery({ page: query.page, pageSize: query.pageSize ?? ADMIN_PAGE_SIZE, roleId: query.roleId, departmentId: query.departmentId, active: query.active === undefined ? undefined : String(query.active), search: query.search })}`,
    ),
  createUser: (body: object) => request<AdminUser>('/users', json('POST', body)),
  editUser: (id: string, body: object) => request<AdminUser>(`/users/${id}`, json('PUT', body)),
  deactivateUser: (id: string) => request<AdminUser>(`/users/${id}/deactivate`, json('POST')),
  roles: (page = 1, active?: boolean, pageSize = ADMIN_PAGE_SIZE) =>
    request<Page<AdminRole>>(
      `/roles${toQuery({ page, pageSize, active: active === undefined ? undefined : String(active) })}`,
    ),
  role: (id: string) => request<AdminRole>(`/roles/${id}`),
  createRole: (body: object) => request<AdminRole>('/roles', json('POST', body)),
  editRole: (id: string, body: object) => request<AdminRole>(`/roles/${id}`, json('PUT', body)),
  deactivateRole: (id: string, replacementRoleId?: string) =>
    request<AdminRole>(
      `/roles/${id}/deactivate`,
      json('POST', replacementRoleId ? { replacementRoleId } : {}),
    ),
  catalog: () => request<PermissionCatalog>('/permissions/catalog'),
  savePermissions: (id: string, permissions: CapabilitySet['permissions']) =>
    request(`/roles/${id}/permissions`, json('PUT', { permissions })),
  saveJourneyAccess: (id: string, journeyIds: string[]) =>
    request(`/roles/${id}/journey-access`, json('PUT', { journeyIds })),
  saveFieldVisibility: (id: string, fieldVisibility: CapabilitySet['fieldVisibility']) =>
    request(`/roles/${id}/field-visibility`, json('PUT', { fieldVisibility })),
  departments: (page = 1, active?: boolean, pageSize = ADMIN_PAGE_SIZE) =>
    request<Page<Department>>(
      `/departments${toQuery({ page, pageSize, active: active === undefined ? undefined : String(active) })}`,
    ),
  createDepartment: (body: object) => request<Department>('/departments', json('POST', body)),
  editDepartment: (id: string, body: object) =>
    request<Department>(`/departments/${id}`, json('PUT', body)),
  department: (id: string) => request<Department>(`/departments/${id}`),
  teams: (departmentId: string, page = 1, active?: boolean, pageSize = ADMIN_PAGE_SIZE) =>
    request<Page<Team>>(
      `/departments/${departmentId}/teams${toQuery({ page, pageSize, active: active === undefined ? undefined : String(active) })}`,
    ),
  createTeam: (departmentId: string, body: object) =>
    request<Team>(`/departments/${departmentId}/teams`, json('POST', body)),
  editTeam: (id: string, body: object) => request<Team>(`/teams/${id}`, json('PUT', body)),
  deactivateTeam: (id: string) => request<Team>(`/teams/${id}/deactivate`, json('POST', {})),
  saveTeamMembers: (id: string, members: TeamMember[]) =>
    request<TeamMember[]>(`/teams/${id}/members`, json('PUT', { members })),
  ...purgeCalls,
};

/**
 * Per-Status assignment routing.
 *
 * Rule configuration and the per-Status role grants are separate endpoints on
 * purpose: the first is gated on `lead_routing:configure`, the second on
 * `roles_permissions:edit`, so configuring routing can never widen who may
 * operate it.
 */
export const routingApi = {
  rule: (statusId: string) =>
    request<{ statusId: string; rule: RoutingRule | null }>(`/statuses/${statusId}/routing`),
  state: (statusId: string) => request<RoutingState>(`/statuses/${statusId}/routing/state`),
  saveRule: (statusId: string, body: object) =>
    request<RoutingRule>(`/statuses/${statusId}/routing`, json('PUT', body)),
  deactivateRule: (statusId: string) =>
    request<RoutingRule>(`/statuses/${statusId}/routing/deactivate`, json('POST', {})),
  grants: (statusId: string) =>
    request<RoutingGrant[]>(`/statuses/${statusId}/routing/permissions`),
  saveGrants: (statusId: string, permissions: RoutingGrant[]) =>
    request<RoutingGrant[]>(
      `/statuses/${statusId}/routing/permissions`,
      json('PUT', { permissions }),
    ),
  assign: (leadId: string, body: object) =>
    request<{ assignedUserId: string; previousUserId: string | null }>(
      `/leads/${leadId}/routing-assign`,
      json('POST', body),
    ),
};

export const campaignsApi = {
  list: () => request<{ total: number; items: Campaign[] }>('/campaigns'),
  get: (id: string) => request<Campaign>(`/campaigns/${id}`),
  create: (body: object) => request<Campaign>('/campaigns', json('POST', body)),
  update: (id: string, body: object) => request<Campaign>(`/campaigns/${id}`, json('PUT', body)),
  setActive: (id: string, active: boolean) =>
    request<Campaign>(`/campaigns/${id}/activation`, json('POST', { active })),
  send: (id: string) =>
    request<{ queued: number; sent: number; failed: number }>(
      `/campaigns/${id}/send`,
      json('POST'),
    ),
};

export const sellersApi = {
  list: (input: SellerListInput) =>
    request<SellerListResponse>(
      `/leads${toQuery({
        search: input.search,
        journeyId: input.journeyId,
        statusId: input.statusId,
        ownerUserId: input.ownerUserId,
        sortBy: input.sortBy,
        sortDirection: input.sortDirection,
        page: input.page,
        pageSize: input.pageSize,
        accessMode: input.accessMode,
        filter: input.filter,
      })}`,
    ),
  detail: (id: string) => request<Seller360Record>(`/leads/${id}`),
  // These return { lead, process } — the raw rows — not a Seller360Record.
  // Typing them as the latter meant `created.id` was silently undefined, which
  // navigated to /sellers/undefined and 500ed on a non-UUID lookup.
  create: (input: CreateLeadInput) =>
    request<LeadMutationResult>('/leads', { method: 'POST', body: JSON.stringify(input) }),
  edit: (id: string, input: EditLeadInput) =>
    request<LeadMutationResult>(`/leads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  shares: (id: string, context: { journeyId: string; assignmentTypes: string[] }) =>
    request<LeadShare[]>(
      `/leads/${id}/shares${toQuery({ journeyId: context.journeyId, assignmentTypes: context.assignmentTypes.join(',') })}`,
    ),
  share: (
    id: string,
    body: {
      journeyId: string;
      assignmentTypes: string[];
      userId: string;
      capabilities: ShareCapability[];
    },
  ) => request(`/leads/${id}/shares`, json('POST', body)),
  updateShare: (id: string, shareId: string, body: object) =>
    request(`/leads/${id}/shares/${shareId}`, json('PUT', body)),
  revokeShare: (id: string, shareId: string, journeyId: string) =>
    request(`/leads/${id}/shares/${shareId}${toQuery({ journeyId })}`, json('DELETE')),

  /*
   * The four below reach endpoints that have existed since phase 9 with no
   * client method at all, so nothing in the UI could call them.
   */
  activity: (
    id: string,
    context: { requestedFieldIds: string[]; assignmentTypes: string[]; page?: number },
  ) =>
    request<{ page: number; pageSize: number; total: number; items: ActivityEntry[] }>(
      `/leads/${id}/activity${toQuery({
        requestedFieldIds: context.requestedFieldIds.join(','),
        assignmentTypes: context.assignmentTypes.join(','),
        page: context.page,
      })}`,
    ),
  comment: (id: string, body: { journeyId: string; assignmentTypes: string[]; text: string }) =>
    request<ActivityEntry>(`/leads/${id}/comments`, json('POST', body)),
  reassign: (
    id: string,
    body: {
      journeyId: string;
      assignmentTypes: string[];
      processInstanceId: string;
      assignmentType: string;
      userId: string;
    },
  ) => request(`/leads/${id}/reassign`, json('PATCH', body)),
  deactivate: (id: string, body: { journeyId: string; assignmentTypes: string[] }) =>
    request(`/leads/${id}/deactivate`, json('POST', body)),
  moveJourney: (
    id: string,
    body: {
      journeyId: string;
      assignmentTypes: string[];
      processInstanceId: string;
      targetJourneyId: string;
      statusId?: string;
    },
  ) => request<{ processInstanceId: string }>(`/leads/${id}/journey`, json('PATCH', body)),
};

export const attachmentsApi = {
  list: (leadId: string, context: LeadContext) =>
    request<{ items: AttachmentRecord[] }>(
      `/leads/${leadId}/attachments${leadContextQuery(context)}`,
    ).then((page) => page.items),
  upload: (leadId: string, context: LeadContext, input: { file: File; name: string }) => {
    const form = new FormData();
    // Name first: the server reads it from the fields already parsed when the
    // file part arrives, and busboy exposes only what it has seen so far.
    form.append('name', input.name);
    form.append('file', input.file);
    return requestMultipart<AttachmentRecord>(
      `/leads/${leadId}/attachments${leadContextQuery(context)}`,
      form,
    );
  },
  download: (attachmentId: string, context: LeadContext) =>
    requestBlob(`/attachments/${attachmentId}${leadContextQuery(context)}`),
  remove: (attachmentId: string, context: LeadContext) =>
    request(`/attachments/${attachmentId}${leadContextQuery(context)}`, json('DELETE')),
};

/** Every lead-scoped call is authorized against a journey plus claimed types. */
export interface LeadContext {
  journeyId: string;
  assignmentTypes: string[];
}

const leadContextQuery = (context: LeadContext) =>
  toQuery({
    journeyId: context.journeyId,
    assignmentTypes: context.assignmentTypes.join(','),
  });

export const notificationsApi = {
  list: (page = 1) =>
    request<{ total: number; items: NotificationItem[] }>(`/notifications${toQuery({ page })}`),
  unread: () => request<{ count: number }>('/notifications/unread-count'),
  markRead: (id: string) => request(`/notifications/${id}/read`, json('PATCH')),
  rules: () => request<{ total: number; items: NotificationRule[] }>('/notification-rules'),
  createRule: (body: object) =>
    request<NotificationRule>('/notification-rules', json('POST', body)),
  updateRule: (id: string, body: object) =>
    request<NotificationRule>(`/notification-rules/${id}`, json('PUT', body)),
};

/**
 * The configuration endpoints return raw Prisma rows, whose column names don't
 * match the client-facing domain types (`active` vs `isActive`, `name` vs
 * `label`, `fieldType` vs `type`). Normalizing here keeps that drift in one
 * place instead of leaking a second shape into every consumer.
 *
 * Each normalizer accepts either spelling so it works against the API and the
 * older mock payloads alike.
 */
type RawStatus = Omit<Status, 'isActive' | 'isDefaultOnCreate'> & {
  isActive?: boolean;
  active?: boolean;
  isDefaultOnCreate?: boolean;
};
type RawField = Partial<FieldDefinition> & {
  id: string;
  key: string;
  name?: string;
  fieldType?: string;
  validationRule?: (FieldValidationRule & { options?: readonly string[] }) | null;
};

function normalizeStatus(row: RawStatus): Status {
  const { active, ...rest } = row;
  return {
    ...rest,
    isActive: row.isActive ?? active ?? true,
    isDefaultOnCreate: row.isDefaultOnCreate ?? false,
  };
}

function normalizeField(row: RawField): FieldDefinition {
  const rule = row.validationRule ?? undefined;
  const options = row.options ?? rule?.options;
  return {
    id: row.id,
    key: row.key,
    label: row.label ?? row.name ?? row.key,
    type: (row.type ?? row.fieldType ?? 'text') as FieldDefinition['type'],
    ...(options ? { options } : {}),
    ...(rule ? { validationRule: rule } : {}),
    // The API has always sent this; the normalizer just dropped it on the
    // floor, so the record page had no way to group details by section.
    ...(row.section === undefined ? {} : { section: row.section }),
  };
}

/** Page envelope, tolerating older handlers that returned a bare array. */
function items<T>(payload: Page<T> | T[]): T[] {
  return Array.isArray(payload) ? payload : (payload.items ?? []);
}

export const configApi = {
  journeys: () => request<Page<Journey> | Journey[]>('/journeys').then(items),
  /**
   * `GET /journeys/:id/statuses` is documented but only registered for POST, so
   * it 404s outside the mocks. `GET /journeys/:id` is registered and already
   * returns its statuses filtered to active and ordered by sortOrder.
   */
  statuses: (journeyId: string) =>
    request<Omit<AdminJourney, 'statuses'> & { statuses?: RawStatus[] }>(
      `/journeys/${journeyId}`,
    ).then((journey) =>
      (journey.statuses ?? [])
        .map(normalizeStatus)
        .sort((left, right) => left.sortOrder - right.sortOrder),
    ),
  /**
   * The assignment types actually in use on a Journey. `assignment_type` is a
   * configurable free-text string with no enum and no other endpoint listing
   * the permitted values, so this is the only way a client can assign someone
   * without inventing a literal.
   */
  assignmentTypes: (journeyId: string) =>
    request<{ assignmentTypes?: string[] }>(`/journeys/${journeyId}`).then(
      (journey) => journey.assignmentTypes ?? [],
    ),
  fields: () =>
    request<Page<RawField> | RawField[]>('/fields')
      .then(items)
      .then((rows) => rows.map(normalizeField)),
  services: () => request<Page<Service> | Service[]>('/services').then(items),
};

/**
 * Bulk import and export.
 *
 * The file is held by the browser across all three steps and re-sent each time,
 * because the server stores nothing between them — object storage is optional
 * (ADR-0012) and a run that spans requests would need somewhere to put it.
 * `contentHash` is what makes that safe: the preview returns it, `commit`
 * echoes it, and the server refuses a commit whose bytes hash differently, so
 * what gets created is what was previewed.
 */
export const importApi = {
  analyze: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return requestMultipart<ImportAnalysis>('/leads/import/analyze', form);
  },
  run: (
    mode: 'preview' | 'commit',
    input: {
      file: File;
      mapping: ImportMapping;
      stopOnError?: boolean;
      /** Required on commit; the server compares it to the bytes it received. */
      contentHash?: string;
    },
  ) => {
    const form = new FormData();
    form.append('mapping', JSON.stringify(input.mapping));
    if (input.stopOnError) form.append('stopOnError', 'true');
    if (input.contentHash !== undefined) form.append('contentHash', input.contentHash);
    form.append('file', input.file);
    return requestMultipart<ImportRunResult>(`/leads/import/${mode}`, form);
  },
};

export const exportApi = {
  /**
   * The Seller List as CSV, under whatever filters are on screen. Deliberately
   * the same query shape `sellersApi.list` sends, so "export what I am looking
   * at" is one set of parameters rather than two that have to agree.
   */
  sellers: (input: SellerListInput) =>
    requestBlob(
      `/leads/export${toQuery({
        search: input.search,
        journeyId: input.journeyId,
        statusId: input.statusId,
        ownerUserId: input.ownerUserId,
        sortBy: input.sortBy,
        sortDirection: input.sortDirection,
        accessMode: input.accessMode,
        filter: input.filter,
      })}`,
    ),
};
