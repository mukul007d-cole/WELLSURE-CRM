import { ApiError } from './api-error';
import type {
  CreateLeadInput,
  EditLeadInput,
  FieldDefinition,
  Journey,
  Seller360Record,
  SellerListInput,
  SellerListResponse,
  Service,
  SessionUser,
  Status,
  CapabilitySet,
  Page,
  AdminJourney,
  AdminField,
  AdminUser,
  AdminRole,
  Department,
  PermissionCatalog,
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
      })}`,
    ),
  detail: (id: string) => request<Seller360Record>(`/leads/${id}`),
  create: (input: CreateLeadInput) =>
    request<Seller360Record>('/leads', { method: 'POST', body: JSON.stringify(input) }),
  edit: (id: string, input: EditLeadInput) =>
    request<Seller360Record>(`/leads/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
};

export const configApi = {
  journeys: () => request<Journey[]>('/journeys'),
  statuses: (journeyId: string) => request<Status[]>(`/journeys/${journeyId}/statuses`),
  fields: () => request<FieldDefinition[]>('/fields'),
  services: () => request<Service[]>('/services'),
};
