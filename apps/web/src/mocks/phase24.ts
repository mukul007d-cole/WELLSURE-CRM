import { http, HttpResponse } from 'msw';

import type { FollowUp, JourneyMembers } from '../types/domain';
import { LEADS, STATUSES, USERS } from './fixtures';

/**
 * Mock handlers for the Phase 24 endpoints (ADR-0025, ADR-0026): status rules,
 * role reporting lines, journey members and follow-ups. Kept apart from
 * `handlers.ts` so the new surface is reviewable in one place.
 */
const API_BASE = '/api/v1';

const reportingLines = new Map<string, string[]>();
const journeyMembers = new Map<string, JourneyMembers>();
export const MOCK_FOLLOW_UPS: FollowUp[] = [];

function seedFollowUps(): FollowUp[] {
  const lead = LEADS[0];
  const user = USERS[0];
  if (lead === undefined || user === undefined) return [];
  const day = 86_400_000;
  const base = {
    leadId: lead.id,
    leadName: lead.name,
    processInstanceId: null,
    journeyId: null,
    journeyName: null,
    statusId: null,
    statusName: null,
    assignedToUserId: user.id,
    assignedToName: user.name,
    completedAt: null,
    completedByName: null,
    createdAt: new Date(Date.now() - 3 * day).toISOString(),
  };
  return [
    {
      ...base,
      id: 'follow-up-overdue',
      dueDate: new Date(Date.now() - day).toISOString(),
      status: 'open',
      note: 'Call back about pricing',
    },
    {
      ...base,
      id: 'follow-up-upcoming',
      dueDate: new Date(Date.now() + 3 * day).toISOString(),
      status: 'open',
      note: null,
    },
  ];
}

export function resetPhase24MockState() {
  reportingLines.clear();
  journeyMembers.clear();
  MOCK_FOLLOW_UPS.splice(0, MOCK_FOLLOW_UPS.length, ...seedFollowUps());
}
resetPhase24MockState();

function viewOf(task: FollowUp, now: number): 'overdue' | 'today' | 'upcoming' | 'done' | null {
  if (task.status === 'done') return 'done';
  if (task.status !== 'open') return null;
  const due = Date.parse(task.dueDate);
  const endOfDay = new Date(now);
  endOfDay.setHours(24, 0, 0, 0);
  if (due < now) return 'overdue';
  return due < endOfDay.getTime() ? 'today' : 'upcoming';
}

export const phase24Handlers = [
  http.put(`${API_BASE}/statuses/:id/rules`, async ({ params, request }) => {
    const body = (await request.json()) as { allowedRoleIds: string[]; requiredFieldIds: string[] };
    const row = STATUSES.find((status) => status.id === params.id);
    if (!row) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    row.allowedRoles = body.allowedRoleIds.map((roleId) => ({ roleId }));
    row.requiredFields = body.requiredFieldIds.map((fieldId) => ({ fieldId }));
    return HttpResponse.json({ statusId: row.id, ...body });
  }),
  http.get(`${API_BASE}/roles/:id/reporting-lines`, ({ params }) =>
    HttpResponse.json({ reportsToRoleIds: reportingLines.get(String(params.id)) ?? [] }),
  ),
  http.put(`${API_BASE}/roles/:id/reporting-lines`, async ({ params, request }) => {
    const body = (await request.json()) as { reportsToRoleIds: string[] };
    if (body.reportsToRoleIds.includes(String(params.id)))
      return HttpResponse.json({ error: 'validation_error' }, { status: 400 });
    reportingLines.set(String(params.id), body.reportsToRoleIds);
    return HttpResponse.json(body);
  }),
  http.get(`${API_BASE}/journeys/:id/members`, ({ params }) =>
    HttpResponse.json(
      journeyMembers.get(String(params.id)) ?? { restrictToMembers: false, userIds: [] },
    ),
  ),
  http.put(`${API_BASE}/journeys/:id/members`, async ({ params, request }) => {
    const body = (await request.json()) as JourneyMembers;
    journeyMembers.set(String(params.id), body);
    return HttpResponse.json(body);
  }),
  http.get(`${API_BASE}/tasks/summary`, () => {
    const now = Date.now();
    const counts = { overdue: 0, today: 0, upcoming: 0 };
    for (const task of MOCK_FOLLOW_UPS) {
      const view = viewOf(task, now);
      if (view !== null && view !== 'done') counts[view] += 1;
    }
    return HttpResponse.json(counts);
  }),
  http.get(`${API_BASE}/tasks`, ({ request }) => {
    const url = new URL(request.url);
    const view = url.searchParams.get('view') ?? 'today';
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '25');
    const now = Date.now();
    const rows = MOCK_FOLLOW_UPS.filter((task) => viewOf(task, now) === view);
    return HttpResponse.json({
      page,
      pageSize,
      total: rows.length,
      truncated: false,
      items: rows.slice((page - 1) * pageSize, page * pageSize),
    });
  }),
  http.get(`${API_BASE}/leads/:id/tasks`, ({ params }) =>
    HttpResponse.json({ items: MOCK_FOLLOW_UPS.filter((task) => task.leadId === params.id) }),
  ),
  http.patch(`${API_BASE}/tasks/:id`, async ({ params, request }) => {
    const body = (await request.json()) as { action: string; dueAt?: string; note?: string | null };
    const task = MOCK_FOLLOW_UPS.find((row) => row.id === params.id);
    if (!task) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    const now = new Date().toISOString();
    if (body.action === 'complete' || body.action === 'cancel') {
      task.status = body.action === 'complete' ? 'done' : 'cancelled';
      task.completedAt = now;
      task.completedByName = task.assignedToName;
      if (body.note !== undefined) task.note = body.note;
      return HttpResponse.json(task);
    }
    if (body.action === 'reopen') {
      task.status = 'open';
      task.completedAt = null;
      task.completedByName = null;
      return HttpResponse.json(task);
    }
    if (!body.dueAt) return HttpResponse.json({ error: 'validation_error' }, { status: 400 });
    task.status = 'rescheduled';
    const next: FollowUp = {
      ...task,
      id: `follow-up-${Date.now()}`,
      status: 'open',
      dueDate: body.dueAt,
      note: body.note === undefined ? task.note : body.note,
      completedAt: null,
      completedByName: null,
    };
    MOCK_FOLLOW_UPS.push(next);
    return HttpResponse.json(next);
  }),
];
