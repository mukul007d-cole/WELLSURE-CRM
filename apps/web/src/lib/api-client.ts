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
} from '../types/domain';

const API_BASE = '/api/v1';

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
