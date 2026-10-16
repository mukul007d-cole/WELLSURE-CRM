import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { AuthProvider } from '../../app/AuthContext';
import { PageChromeProvider } from '../../app/page-chrome';
import { formatFollowUpDate } from '../../components/leads/status-entry';
import { FIELDS, JOURNEYS, LEADS, STATUSES } from '../../mocks/fixtures';
import { MOCK_FOLLOW_UPS } from '../../mocks/phase24';
import { createSession, setCookieHeader } from '../../mocks/session';
import { server } from '../../test/setup';
import { followUpKeys } from '../follow-ups/follow-up-queries';
import { Seller360Page } from './Seller360Page';

/*
 * The ADR-0026 pieces of the record: its status control, its follow-ups
 * and how both read back in the timeline. Kept apart from
 * `Seller360Page.test.tsx`, which covers the workspace itself.
 */

const LEAD = LEADS[0]!;
const PROCESS = LEAD.processInstances[0]!;

function grantLeads(actions: string[]) {
  server.use(
    http.get('/api/v1/auth/capabilities', () =>
      HttpResponse.json({
        permissions: [
          ...actions.map((action) => ({ module: 'leads', action, scope: 'ORGANIZATION' })),
          { module: 'fields', action: 'view', scope: 'ORGANIZATION' },
          { module: 'journeys_statuses', action: 'view', scope: 'ORGANIZATION' },
        ],
        journeyIds: JOURNEYS.map((journey) => journey.id),
        fieldVisibility: FIELDS.map((field) => ({ fieldId: field.id, accessLevel: 'EDIT' })),
      }),
    ),
  );
}

/** Every PATCH /leads/:id body, oldest first. Nothing is written to fixtures. */
function captureLeadPatches() {
  const bodies: Array<Record<string, unknown>> = [];
  server.use(
    http.patch('/api/v1/leads/:id', async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({
        lead: { id: LEAD.id, name: LEAD.name },
        process: { id: PROCESS.processInstanceId, journeyId: PROCESS.journeyId },
      });
    }),
  );
  return bodies;
}

function stubActivity(items: unknown[]) {
  server.use(
    http.get('/api/v1/leads/:id/activity', () =>
      HttpResponse.json({ page: 1, pageSize: 25, total: items.length, items }),
    ),
  );
}

function entry(overrides: Record<string, unknown>) {
  return {
    id: `entry-${Math.random()}`,
    processInstanceId: null,
    actorUserId: 'user-admin',
    actorName: 'Synthetic Actor',
    timestamp: new Date().toISOString(),
    actionType: 'comment',
    source: 'lead_api',
    commentText: null,
    oldValue: null,
    newValue: null,
    ...overrides,
  };
}

function renderRecord(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  document.cookie = setCookieHeader(createSession('user-admin'));
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/sellers/${LEAD.id}`]}>
        <AuthProvider>
          <PageChromeProvider fallbackTitle="Wellsure CRM">
            <Routes>
              <Route path="/sellers/:sellerId" element={<Seller360Page />} />
            </Routes>
          </PageChromeProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

async function openFollowUpsTab() {
  fireEvent.click(await screen.findByRole('tab', { name: /Follow-ups/ }));
}

beforeEach(() => {
  sessionStorage.clear();
  document.cookie = 'falcon_session=; Path=/; Max-Age=0';
});

describe('record follow-ups', () => {
  it('lists open follow-ups first, then the history', async () => {
    grantLeads(['view', 'edit']);
    MOCK_FOLLOW_UPS.push({
      ...MOCK_FOLLOW_UPS[0]!,
      id: 'follow-up-done',
      status: 'done',
      note: 'Synthetic finished call',
      completedAt: new Date().toISOString(),
      completedByName: 'Synthetic Closer',
    });
    renderRecord();
    await openFollowUpsTab();

    const open = await screen.findByRole('list', { name: 'Open follow-ups' });
    const openItems = within(open).getAllByRole('listitem');
    expect(openItems).toHaveLength(2);
    // Soonest due first: the overdue one leads, and says so.
    expect(openItems[0]).toHaveTextContent('Call back about pricing');
    expect(within(openItems[0]!).getByText('Overdue')).toBeInTheDocument();

    const history = screen.getByRole('list', { name: 'Follow-up history' });
    expect(within(history).getByText('Synthetic finished call')).toBeInTheDocument();
    expect(within(history).getByText('Done')).toBeInTheDocument();
    expect(within(history).getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
  });

  it('completes an open follow-up and refreshes the sidebar badge', async () => {
    grantLeads(['view', 'edit']);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Stands in for the sidebar badge's cached counts.
    client.setQueryData(followUpKeys.summary(), { overdue: 1, today: 0, upcoming: 1 });
    renderRecord(client);
    await openFollowUpsTab();

    const open = await screen.findByRole('list', { name: 'Open follow-ups' });
    const overdue = within(open).getAllByRole('listitem')[0]!;
    fireEvent.click(within(overdue).getByRole('button', { name: 'Done' }));

    const history = await screen.findByRole('list', { name: 'Follow-up history' });
    expect(await within(history).findByText('Call back about pricing')).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Open follow-ups' })).getAllByRole('listitem'),
    ).toHaveLength(1);
    expect(MOCK_FOLLOW_UPS.find((task) => task.id === 'follow-up-overdue')?.status).toBe('done');
    expect(client.getQueryState(followUpKeys.summary())?.isInvalidated).toBe(true);
  });

  it('schedules a follow-up through the lead edit with nothing but the follow-up', async () => {
    grantLeads(['view', 'edit']);
    const bodies = captureLeadPatches();
    renderRecord();
    await openFollowUpsTab();

    fireEvent.click(await screen.findByRole('button', { name: 'Schedule follow-up' }));
    const dialog = await screen.findByRole('dialog', { name: 'Schedule follow-up' });
    fireEvent.change(within(dialog).getByLabelText(/Follow-up date and time/), {
      target: { value: '2026-11-02T10:30' },
    });
    fireEvent.change(within(dialog).getByLabelText('Follow-up note'), {
      target: { value: 'Synthetic scheduled note' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      leadId: LEAD.id,
      processInstanceId: PROCESS.processInstanceId,
      journeyId: PROCESS.journeyId,
      followUp: {
        dueAt: new Date('2026-11-02T10:30').toISOString(),
        note: 'Synthetic scheduled note',
      },
    });
    expect(bodies[0]).not.toHaveProperty('statusId');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('leaves out the actions for a viewer who can neither edit nor owns the follow-up', async () => {
    grantLeads(['view']);
    for (const task of MOCK_FOLLOW_UPS) task.assignedToUserId = 'user-someone-else';
    renderRecord();
    await openFollowUpsTab();

    const open = await screen.findByRole('list', { name: 'Open follow-ups' });
    expect(within(open).queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Schedule follow-up' })).not.toBeInTheDocument();
  });
});

describe('record status control', () => {
  it('goes through the shared status-change dialog for a status with reasons', async () => {
    grantLeads(['view', 'edit']);
    const target = STATUSES.find(
      (status) =>
        status.journeyId === PROCESS.journeyId &&
        status.id !== PROCESS.statusId &&
        status.behaviorType === 'default',
    )!;
    target.reasonOptions = ['Synthetic reason A', 'Synthetic reason B'];
    const bodies = captureLeadPatches();
    renderRecord();

    fireEvent.click(await screen.findByRole('button', { name: `Change status for ${LEAD.name}` }));
    const menu = await screen.findByRole('listbox', { name: 'Move to status' });
    fireEvent.click(within(menu).getByRole('option', { name: target.name }));

    const dialog = await screen.findByRole('dialog', { name: `Move to ${target.name}` });
    fireEvent.change(within(dialog).getByLabelText('Reason'), {
      target: { value: 'Synthetic reason A' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change status' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ statusId: target.id, statusReason: 'Synthetic reason A' });
  });
});

describe('timeline follow-ups and reasons', () => {
  it('renders follow-up entries, a status reason and an imported remark', async () => {
    grantLeads(['view']);
    const dueAt = '2026-11-02T05:00:00.000Z';
    const previousDueAt = '2026-10-30T05:00:00.000Z';
    const status = STATUSES.find((row) => row.journeyId === PROCESS.journeyId)!;
    stubActivity([
      entry({
        actionType: 'follow_up',
        newValue: {
          taskId: 'task-1',
          dueAt,
          note: 'Synthetic timeline note',
          assignedToUserId: 'user-admin',
        },
      }),
      entry({
        actionType: 'follow_up',
        oldValue: { taskId: 'task-0', status: 'open', dueAt: previousDueAt },
        newValue: { taskId: 'task-2', dueAt, assignedToUserId: 'user-admin' },
      }),
      entry({ actionType: 'follow_up', newValue: { taskId: 'task-1', status: 'done' } }),
      entry({ actionType: 'follow_up', newValue: { taskId: 'task-1', status: 'cancelled' } }),
      entry({ actionType: 'follow_up', newValue: { taskId: 'task-1', status: 'open' } }),
      entry({
        actionType: 'status_change',
        oldValue: { statusId: 'status-unknown' },
        newValue: { statusId: status.id, reason: 'Synthetic status reason' },
      }),
      entry({
        actorUserId: null,
        actorName: null,
        source: 'migrated_synthetic_remark',
        commentText: 'Synthetic imported remark',
      }),
      entry({ commentText: 'Synthetic live comment' }),
    ]);
    renderRecord();

    // Anchored, so it doesn't also match "rescheduled".
    expect(await screen.findByText(/(^|\s)scheduled a follow-up/)).toBeInTheDocument();
    expect(screen.getByText('Synthetic timeline note')).toBeInTheDocument();
    expect(screen.getAllByText(formatFollowUpDate(dueAt))).toHaveLength(2);
    expect(screen.getByText(/rescheduled a follow-up/)).toBeInTheDocument();
    expect(screen.getByText(formatFollowUpDate(previousDueAt))).toBeInTheDocument();
    expect(screen.getByText(/completed a follow-up/)).toBeInTheDocument();
    expect(screen.getByText(/cancelled a follow-up/)).toBeInTheDocument();
    expect(screen.getByText(/reopened a follow-up/)).toBeInTheDocument();

    // The status name resolves once the journey's statuses have loaded.
    expect(
      await screen.findByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent === `${status.name} · reason: Synthetic status reason`,
      ),
    ).toBeInTheDocument();

    const imported = screen.getByText('Synthetic imported remark').closest('li')!;
    expect(within(imported).getByText('Imported')).toBeInTheDocument();
    const live = screen.getByText('Synthetic live comment').closest('li')!;
    expect(within(live).queryByText('Imported')).not.toBeInTheDocument();
  });
});
