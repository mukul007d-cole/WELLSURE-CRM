import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { delay, http, HttpResponse } from 'msw';
import { AuthProvider } from '../../app/AuthContext';
import { PreferencesProvider } from '../../app/preferences';
import { FIELDS, JOURNEYS, STATUSES } from '../../mocks/fixtures';
import type { Status } from '../../types/domain';
import { createSession, setCookieHeader } from '../../mocks/session';
import { server } from '../../test/setup';
import { BoardPage } from './BoardPage';

const JOURNEY_ID = JOURNEYS[0]!.id;
const NEW_STATUS = `status-${JOURNEYS[0]!.key}-new`;
const WON_STATUS = `status-${JOURNEYS[0]!.key}-won`;
const DEAL_VALUE_FIELD = 'field-deal-value';

/** Grants the signed-in fixture user leads access the seed role doesn't carry. */
function grantLeadPermissions(actions: string[]) {
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

/**
 * Two columns with one card each, so a move is unambiguous and the totals are
 * easy to assert. `total` deliberately exceeds the rows returned, proving the
 * header count comes from the server's scoped count and not from rows.length.
 */
function stubColumns() {
  server.use(
    http.get('/api/v1/leads', ({ request }) => {
      const statusId = new URL(request.url).searchParams.get('statusId');
      if (statusId === NEW_STATUS) {
        return HttpResponse.json({
          total: 5,
          rows: [
            {
              id: 'lead-1',
              name: 'Synthetic Alpha',
              phone: '0000000001',
              email: null,
              fieldValues: {},
              processInstances: [
                {
                  processInstanceId: 'pi-1',
                  journeyId: JOURNEY_ID,
                  journeyName: JOURNEYS[0]!.name,
                  statusId: NEW_STATUS,
                  statusName: 'New Lead',
                  statusOutcomeType: 'open',
                  statusBehaviorType: 'default',
                  ownerName: 'Synthetic Owner',
                },
              ],
            },
          ],
        });
      }
      return HttpResponse.json({ total: statusId === WON_STATUS ? 2 : 0, rows: [] });
    }),
    http.get('/api/v1/leads/:id', () =>
      HttpResponse.json({
        id: 'lead-1',
        name: 'Synthetic Alpha',
        phone: '0000000001',
        email: null,
        fieldValues: {},
        processInstances: [
          {
            processInstanceId: 'pi-1',
            journeyId: JOURNEY_ID,
            active: true,
            journey: { id: JOURNEY_ID, key: JOURNEYS[0]!.key, name: JOURNEYS[0]!.name },
            currentStatus: {
              id: NEW_STATUS,
              key: 'new',
              name: 'New Lead',
              outcomeType: 'open',
              behaviorType: 'default',
            },
            assignments: [
              { id: 'a1', assignmentType: 'owner', userId: 'user-admin', userName: 'Priya Shah' },
            ],
          },
        ],
      }),
    ),
  );
}

function renderBoard() {
  document.cookie = setCookieHeader(createSession('user-admin'));
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/board']}>
        <AuthProvider>
          <PreferencesProvider>
            <Routes>
              <Route path="/board" element={<BoardPage />} />
            </Routes>
          </PreferencesProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Columns appear only after journeys + statuses resolve, so this must await. */
const findColumn = (name: string) => screen.findByRole('region', { name });
const columnNamed = (name: string) => screen.getByRole('region', { name });

async function moveAlphaToWon() {
  // Driven through the Move menu rather than a synthetic drag: jsdom has no
  // layout, so dnd-kit's collision detection can never resolve a drop target.
  // Both paths call the same mutation, so the optimistic/rollback logic is
  // fully covered either way.
  fireEvent.click(await screen.findByRole('button', { name: 'Move Synthetic Alpha' }));
  // Scoped to the menu: the mobile status picker is a <select> whose <option>
  // elements share the same role and names.
  const menu = await screen.findByRole('listbox', { name: 'Move to status' });
  fireEvent.click(within(menu).getByRole('option', { name: 'Won' }));
}

describe('board', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  it('reverts the card and restores both counts when a required field is missing', async () => {
    grantLeadPermissions(['view', 'edit']);
    stubColumns();
    server.use(
      // Delayed so the optimistic phase is observable before the rejection
      // lands; an instant 400 would revert before any assertion could run.
      http.patch('/api/v1/leads/:id', async () => {
        await delay(120);
        return HttpResponse.json(
          { error: 'validation_error', details: { fieldId: DEAL_VALUE_FIELD } },
          { status: 400 },
        );
      }),
    );

    renderBoard();

    expect(
      await within(await findColumn('New Lead')).findByText('Synthetic Alpha'),
    ).toBeInTheDocument();
    expect(within(columnNamed('New Lead')).getByText('5')).toBeInTheDocument();
    expect(within(columnNamed('Won')).getByText('2')).toBeInTheDocument();

    await moveAlphaToWon();

    // Optimistic: the card is in Won before the server answers.
    expect(await within(columnNamed('Won')).findByText('Synthetic Alpha')).toBeInTheDocument();

    // Rejected: it goes back, and the dialog explains why.
    const dialog = await screen.findByRole('dialog');
    expect(await within(columnNamed('New Lead')).findByText('Synthetic Alpha')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(columnNamed('Won')).queryByText('Synthetic Alpha')).not.toBeInTheDocument(),
    );

    // Totals return to their pre-move values — guards the `total` arithmetic.
    expect(within(columnNamed('New Lead')).getByText('5')).toBeInTheDocument();
    expect(within(columnNamed('Won')).getByText('2')).toBeInTheDocument();

    // Names the configured field and both configured statuses, and links to the form.
    expect(await within(dialog).findByText('Deal Value (₹)')).toBeInTheDocument();
    expect(within(dialog).getByText('New Lead')).toBeInTheDocument();
    expect(within(dialog).getByText('Won')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Open seller form' })).toHaveAttribute(
      'href',
      '/sellers/lead-1/edit',
    );
  });

  it('keeps the card in place when the move succeeds', async () => {
    grantLeadPermissions(['view', 'edit']);
    stubColumns();
    server.use(
      http.patch('/api/v1/leads/:id', async () => {
        await delay(50);
        return HttpResponse.json({ id: 'lead-1' });
      }),
    );

    renderBoard();
    await within(await findColumn('New Lead')).findByText('Synthetic Alpha');
    await moveAlphaToWon();

    expect(await within(columnNamed('Won')).findByText('Synthetic Alpha')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reverts with a banner and no field dialog when the move is forbidden', async () => {
    grantLeadPermissions(['view', 'edit']);
    stubColumns();
    server.use(
      http.patch('/api/v1/leads/:id', () =>
        HttpResponse.json({ error: 'forbidden' }, { status: 403 }),
      ),
    );

    renderBoard();
    await within(await findColumn('New Lead')).findByText('Synthetic Alpha');
    await moveAlphaToWon();

    expect(await screen.findByRole('alert')).toHaveTextContent(/permission/i);
    expect(await within(columnNamed('New Lead')).findByText('Synthetic Alpha')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a generic message for a 400 that carries no fieldId', async () => {
    // Proves the dialog keys off details.fieldId, not merely the status code.
    grantLeadPermissions(['view', 'edit']);
    stubColumns();
    server.use(
      http.patch('/api/v1/leads/:id', () =>
        HttpResponse.json({ error: 'validation_error' }, { status: 400 }),
      ),
    );

    renderBoard();
    await within(await findColumn('New Lead')).findByText('Synthetic Alpha');
    await moveAlphaToWon();

    expect(await screen.findByRole('alert')).toHaveTextContent(/any more/i);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await within(columnNamed('New Lead')).findByText('Synthetic Alpha')).toBeInTheDocument();
  });

  it('never shows a raw field id when the field catalogue is unreadable', async () => {
    grantLeadPermissions(['view', 'edit']);
    stubColumns();
    server.use(
      // The API gates both Field reads on fields:view, so a role that can't
      // read the catalogue can't read the journey's field settings either.
      http.get('/api/v1/fields', () => HttpResponse.json({ error: 'forbidden' }, { status: 403 })),
      http.get('/api/v1/journeys/:id/fields', () =>
        HttpResponse.json({ error: 'forbidden' }, { status: 403 }),
      ),
      http.patch('/api/v1/leads/:id', () =>
        HttpResponse.json(
          { error: 'validation_error', details: { fieldId: DEAL_VALUE_FIELD } },
          { status: 400 },
        ),
      ),
    );

    renderBoard();
    await within(await findColumn('New Lead')).findByText('Synthetic Alpha');
    await moveAlphaToWon();

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/a required field/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(DEAL_VALUE_FIELD)).not.toBeInTheDocument();
    // Nothing it could send would satisfy the server, so it doesn't offer to.
    expect(within(dialog).getByRole('button', { name: 'Change status' })).toBeDisabled();
  });

  it('renders read-only without drag affordances when the viewer lacks leads edit', async () => {
    grantLeadPermissions(['view']);
    stubColumns();

    renderBoard();

    // The board is shown, not hidden.
    expect(
      await within(await findColumn('New Lead')).findByText('Synthetic Alpha'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move Synthetic Alpha' })).not.toBeInTheDocument();
    expect(screen.getByText(/needs edit access/i)).toBeInTheDocument();
  });

  it('shows the server count rather than the number of loaded rows', async () => {
    grantLeadPermissions(['view', 'edit']);
    stubColumns();

    renderBoard();

    const column = await findColumn('New Lead');
    expect(await within(column).findByText('Synthetic Alpha')).toBeInTheDocument();
    // One row loaded, five in scope.
    expect(within(column).getByText('5')).toBeInTheDocument();
  });

  it('explains itself when journey configuration is forbidden', async () => {
    grantLeadPermissions(['view', 'edit']);
    server.use(
      http.get('/api/v1/journeys', () =>
        HttpResponse.json({ error: 'forbidden' }, { status: 403 }),
      ),
      http.get('/api/v1/journeys/:id', () =>
        HttpResponse.json({ error: 'forbidden' }, { status: 403 }),
      ),
    );

    renderBoard();

    expect(await screen.findByText(/isn't visible to your role/i)).toBeInTheDocument();
  });
});

describe('board status rules (ADR-0026)', () => {
  const FOLLOW_UP_STATUS = `status-${JOURNEYS[0]!.key}-follow_up`;
  const LOST_STATUS = `status-${JOURNEYS[0]!.key}-lost`;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  /** Configures a fixture status; the test setup restores STATUSES afterwards. */
  function configureStatus(id: string, rules: Partial<Status>) {
    Object.assign(
      STATUSES.find((status) => status.id === id)!,
      rules,
    );
  }

  /** Every PATCH body, oldest first; answers each with the next response. */
  function capturePatches(responses: Array<() => Response> = []) {
    const bodies: Array<Record<string, unknown>> = [];
    server.use(
      http.patch('/api/v1/leads/:id', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        const respond = responses[bodies.length - 1];
        return respond ? respond() : HttpResponse.json({ id: 'lead-1' });
      }),
    );
    return bodies;
  }

  async function openMoveMenu() {
    await within(await findColumn('New Lead')).findByText('Synthetic Alpha');
    fireEvent.click(await screen.findByRole('button', { name: 'Move Synthetic Alpha' }));
    return screen.findByRole('listbox', { name: 'Move to status' });
  }

  it('changes a plain status in one click, with nothing extra in the request', async () => {
    grantLeadPermissions(['view', 'edit']);
    stubColumns();
    const bodies = capturePatches();

    renderBoard();
    fireEvent.click(within(await openMoveMenu()).getByRole('option', { name: 'Won' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(bodies[0]).toMatchObject({ statusId: WON_STATUS });
    expect(bodies[0]).not.toHaveProperty('statusReason');
    expect(bodies[0]).not.toHaveProperty('followUp');
    expect(bodies[0]).not.toHaveProperty('fieldValues');
  });

  it('asks for a reason before a status that has them, and sends the one chosen', async () => {
    grantLeadPermissions(['view', 'edit']);
    stubColumns();
    configureStatus(WON_STATUS, { reasonOptions: ['Synthetic reason A', 'Synthetic reason B'] });
    const bodies = capturePatches();

    renderBoard();
    fireEvent.click(within(await openMoveMenu()).getByRole('option', { name: 'Won' }));

    const dialog = await screen.findByRole('dialog', { name: 'Move to Won' });
    // Nothing is saved until the dialog is submitted.
    expect(bodies).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText('Reason'), {
      target: { value: 'Synthetic reason B' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change status' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ statusId: WON_STATUS, statusReason: 'Synthetic reason B' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('prompts for a follow-up on a follow-up status and sends it with the change', async () => {
    grantLeadPermissions(['view', 'edit']);
    stubColumns();
    const bodies = capturePatches();

    renderBoard();
    fireEvent.click(within(await openMoveMenu()).getByRole('option', { name: 'Follow Up' }));

    const dialog = await screen.findByRole('dialog', { name: 'Move to Follow Up' });
    fireEvent.change(within(dialog).getByLabelText('Follow-up date and time'), {
      target: { value: '2026-11-02T10:30' },
    });
    fireEvent.change(within(dialog).getByLabelText('Follow-up note'), {
      target: { value: 'Synthetic callback note' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change status' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      statusId: FOLLOW_UP_STATUS,
      followUp: {
        dueAt: new Date('2026-11-02T10:30').toISOString(),
        note: 'Synthetic callback note',
      },
    });
  });

  it('offers only the statuses the viewer’s role may choose', async () => {
    grantLeadPermissions(['view', 'edit']);
    stubColumns();
    // The signed-in fixture user holds role-admin.
    configureStatus(WON_STATUS, { allowedRoles: [{ roleId: 'role-sales-rep' }] });
    configureStatus(LOST_STATUS, { allowedRoles: [{ roleId: 'role-admin' }] });

    renderBoard();
    const menu = await openMoveMenu();

    expect(within(menu).queryByRole('option', { name: 'Won' })).not.toBeInTheDocument();
    expect(within(menu).getByRole('option', { name: 'Lost' })).toBeInTheDocument();
    // Unrestricted statuses stay on offer.
    expect(within(menu).getByRole('option', { name: 'Contacted' })).toBeInTheDocument();
    // The column itself still shows; it just can't be chosen.
    expect(columnNamed('Won')).toBeInTheDocument();
  });

  it('re-prompts for every field a 400 names and resubmits with their values', async () => {
    grantLeadPermissions(['view', 'edit']);
    stubColumns();
    const bodies = capturePatches([
      () =>
        HttpResponse.json(
          { error: 'validation_error', details: { fieldIds: [DEAL_VALUE_FIELD] } },
          { status: 400 },
        ),
    ]);

    renderBoard();
    fireEvent.click(within(await openMoveMenu()).getByRole('option', { name: 'Won' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'That move needs more information first',
    });
    expect(await within(columnNamed('New Lead')).findByText('Synthetic Alpha')).toBeInTheDocument();
    fireEvent.change(await within(dialog).findByLabelText(/Deal Value/), {
      target: { value: '125000' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change status' }));

    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toMatchObject({
      statusId: WON_STATUS,
      fieldValues: { [DEAL_VALUE_FIELD]: 125000 },
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says the role can’t use a status when the server refuses it by name', async () => {
    grantLeadPermissions(['view', 'edit']);
    stubColumns();
    capturePatches([
      () =>
        HttpResponse.json(
          { error: 'forbidden', details: { statusId: WON_STATUS } },
          { status: 403 },
        ),
    ]);

    renderBoard();
    fireEvent.click(within(await openMoveMenu()).getByRole('option', { name: 'Won' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Your role can't move leads into this status",
    );
    expect(await within(columnNamed('New Lead')).findByText('Synthetic Alpha')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
