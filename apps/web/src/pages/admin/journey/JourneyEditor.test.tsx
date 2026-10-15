import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { AuthProvider } from '../../../app/AuthContext';
import { STATUSES } from '../../../mocks/fixtures';
import { createSession, setCookieHeader } from '../../../mocks/session';
import { server } from '../../../test/setup';
import type { JourneyMembers } from '../../../types/domain';
import { JourneyDetailPage } from '../JourneyDetailPage';

/**
 * The Phase 24 Journey editor: status rules, journey members and the
 * `required_on_create` Field requirement. Synthetic fixtures only — the
 * journey, status, role and field names below are mock data, not anything
 * the editor knows about.
 */
const JOURNEY_ID = 'journey-alpha';
const FIRST_STATUS_ID = 'status-journey_alpha-new';

function renderEditor(query = '') {
  const token = createSession('user-admin');
  document.cookie = setCookieHeader(token);
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[`/admin/journeys/${JOURNEY_ID}${query}`]}>
        <AuthProvider>
          <Routes>
            <Route path="/admin/journeys/:journeyId" element={<JourneyDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openFirstStatusEditor() {
  fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0] as HTMLElement);
  return screen.findByRole('group', { name: /Who can choose this status/ });
}

function capabilities(permissions: string[]) {
  return http.get('/api/v1/auth/capabilities', () =>
    HttpResponse.json({
      permissions: permissions.map((value) => {
        const [module, action] = value.split(':');
        return { module, action, scope: 'ORGANIZATION' };
      }),
      journeyIds: [JOURNEY_ID],
      fieldVisibility: [],
    }),
  );
}

describe('Journey editor — Phase 24', () => {
  beforeEach(() => {
    sessionStorage.clear();
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  it('saves a status’s color and reasons through PATCH and its rules through PUT /rules', async () => {
    renderEditor();
    const roles = await openFirstStatusEditor();

    fireEvent.click(screen.getByRole('radio', { name: 'Teal' }));
    expect(screen.getByRole('radio', { name: 'Teal' })).toHaveAttribute('aria-checked', 'true');

    const reason = screen.getByLabelText('New reason');
    fireEvent.change(reason, { target: { value: 'Synthetic reason one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add reason' }));
    fireEvent.change(reason, { target: { value: 'Synthetic reason two' } });
    fireEvent.keyDown(reason, { key: 'Enter' });
    fireEvent.change(reason, { target: { value: 'Synthetic reason three' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add reason' }));
    // A duplicate is refused before it reaches the server.
    fireEvent.change(reason, { target: { value: 'Synthetic reason one' } });
    expect(screen.getByRole('button', { name: 'Add reason' })).toBeDisabled();
    fireEvent.change(reason, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove reason Synthetic reason three' }));

    fireEvent.click(await within(roles).findByLabelText('Synthetic role B'));
    const required = screen.getByRole('group', { name: /Required to enter/ });
    fireEvent.click(await within(required).findByLabelText('Company Name'));

    fireEvent.click(screen.getByRole('button', { name: 'Save Status' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save Status' })).not.toBeInTheDocument(),
    );

    const row = STATUSES.find((status) => status.id === FIRST_STATUS_ID);
    expect(row).toMatchObject({
      color: 'teal',
      reasonOptions: ['Synthetic reason one', 'Synthetic reason two'],
      allowedRoles: [{ roleId: 'role-sales-rep' }],
      requiredFields: [{ fieldId: 'field-company' }],
    });

    // The list summarises the rules on the Status's row.
    expect(await screen.findByText('1 role')).toBeInTheDocument();
    expect(screen.getByText('1 required')).toBeInTheDocument();
    expect(screen.getByText('2 reasons')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'Color: Teal' })).toHaveLength(1);
  });

  it('clears a color back to none and leaves the rules endpoint alone when they did not change', async () => {
    const row = STATUSES.find((status) => status.id === FIRST_STATUS_ID)!;
    row.color = 'red';
    let patchBody: Record<string, unknown> | undefined;
    let rulesWrites = 0;
    server.use(
      http.patch('/api/v1/statuses/:id', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...row, ...patchBody });
      }),
      http.put('/api/v1/statuses/:id/rules', () => {
        rulesWrites += 1;
        return HttpResponse.json({});
      }),
    );
    renderEditor();
    await openFirstStatusEditor();
    expect(screen.getByRole('radio', { name: 'Red' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'No color' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Status' }));

    await waitFor(() => expect(patchBody).toBeDefined());
    expect(patchBody).toMatchObject({ color: null, reasonOptions: [], journeyId: JOURNEY_ID });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save Status' })).not.toBeInTheDocument(),
    );
    expect(rulesWrites).toBe(0);
  });

  it('offers only Fields shown on the Journey as required to enter', async () => {
    server.use(
      http.get('/api/v1/journeys/:id/fields', () =>
        HttpResponse.json([
          {
            fieldId: 'field-company',
            journeyId: JOURNEY_ID,
            requirement: 'optional',
            requiredFromStatusId: null,
            requiredRoleIds: [],
            field: { id: 'field-company', name: 'Company Name' },
          },
          {
            fieldId: 'field-category',
            journeyId: JOURNEY_ID,
            requirement: 'hidden',
            requiredFromStatusId: null,
            requiredRoleIds: [],
            field: { id: 'field-category', name: 'Category' },
          },
        ]),
      ),
    );
    renderEditor();
    await openFirstStatusEditor();
    const required = screen.getByRole('group', { name: /Required to enter/ });
    expect(await within(required).findByLabelText('Company Name')).toBeInTheDocument();
    expect(within(required).queryByLabelText(/Category/)).not.toBeInTheDocument();
  });

  it('shows the server’s reason when rules are refused, and retries a new Status as an edit', async () => {
    let creates = 0;
    let rulesAttempts = 0;
    server.use(
      http.post('/api/v1/journeys/:id/statuses', async ({ request }) => {
        creates += 1;
        const body = (await request.json()) as Record<string, unknown>;
        const created = {
          ...body,
          id: 'status-synthetic-new',
          key: 'synthetic_new',
          journeyId: JOURNEY_ID,
          isActive: true,
          isDefaultOnCreate: false,
        };
        STATUSES.push(created as (typeof STATUSES)[number]);
        return HttpResponse.json(created, { status: 201 });
      }),
      http.put('/api/v1/statuses/:id/rules', () => {
        rulesAttempts += 1;
        return rulesAttempts === 1
          ? HttpResponse.json(
              {
                error: 'validation_error',
                reason: 'every required field must be shown on the status journey',
              },
              { status: 400 },
            )
          : HttpResponse.json({});
      }),
    );
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: 'Create Status' }));
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Synthetic New' } });
    const required = screen.getByRole('group', { name: /Required to enter/ });
    fireEvent.click(await within(required).findByLabelText('Company Name'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Status' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Every required field must be shown on the status journey.',
    );
    // The Status itself was created, so the editor now edits it.
    expect(await screen.findByLabelText('Stable key')).toHaveValue('synthetic_new');

    fireEvent.click(screen.getByRole('button', { name: 'Save Status' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save Status' })).not.toBeInTheDocument(),
    );
    expect(creates).toBe(1);
    expect(rulesAttempts).toBe(2);
  });

  it('saves "members only" and the member list from the Members & access tab', async () => {
    let saved: JourneyMembers | undefined;
    server.use(
      http.put('/api/v1/journeys/:id/members', async ({ request }) => {
        saved = (await request.json()) as JourneyMembers;
        return HttpResponse.json(saved);
      }),
    );
    renderEditor();
    fireEvent.click(await screen.findByRole('tab', { name: 'Members & access' }));

    const restrict = await screen.findByRole('switch', {
      name: 'Only members can work this journey',
    });
    expect(restrict).not.toBeChecked();
    fireEvent.click(restrict);

    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'Alba' } });
    fireEvent.click(await screen.findByLabelText(/Alba Fenn/));
    expect(screen.queryByLabelText(/Bo Ridley/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save members' }));
    await waitFor(() => expect(saved).toBeDefined());
    expect(saved).toEqual({ restrictToMembers: true, userIds: ['dir-1'] });
    expect(await screen.findByText('Members saved.')).toBeInTheDocument();
  });

  it('shows members read-only without users:edit, and hides the tab without users:view', async () => {
    server.use(
      capabilities([
        'journeys_statuses:view',
        'journeys_statuses:edit',
        'users:view',
        'lead_routing:view',
      ]),
    );
    const { unmount } = renderEditor('?tab=members');
    expect(
      await screen.findByRole('switch', { name: 'Only members can work this journey' }),
    ).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save members' })).not.toBeInTheDocument();
    unmount();

    server.use(capabilities(['journeys_statuses:view', 'journeys_statuses:edit']));
    renderEditor('?tab=members');
    // Not permitted: the tab is gone and the URL falls back to Statuses.
    expect(await screen.findByRole('tab', { name: /^Statuses/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryByRole('tab', { name: 'Members & access' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Routing' })).not.toBeInTheDocument();
  });

  it('sends required_on_create with its roles, and loads stored roles back into the editor', async () => {
    const putBodies: Array<Record<string, unknown>> = [];
    let stored: Record<string, unknown> = {
      fieldId: 'field-company',
      journeyId: JOURNEY_ID,
      requirement: 'optional',
      requiredFromStatusId: null,
      requiredRoleIds: [],
    };
    server.use(
      http.get('/api/v1/journeys/:id/fields', () =>
        HttpResponse.json([{ ...stored, field: { id: 'field-company', name: 'Company Name' } }]),
      ),
      http.put('/api/v1/journeys/:id/fields/:fieldId', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        putBodies.push(body);
        stored = { ...stored, ...body, requiredRoleIds: body.requiredRoleIds ?? [] };
        return HttpResponse.json(stored);
      }),
    );
    renderEditor('?tab=fields');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit rule' }));
    // The role picker only appears for the create-time requirement.
    expect(screen.queryByRole('group', { name: /for these roles/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Requirement/), {
      target: { value: 'required_on_create' },
    });
    expect(screen.getByRole('option', { name: 'Required when adding a lead' })).toBeInTheDocument();
    const roles = screen.getByRole('group', { name: /for these roles \(empty = everyone\)/ });
    fireEvent.click(await within(roles).findByLabelText('Synthetic role B'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Field rule' }));

    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({
      requirement: 'required_on_create',
      requiredFromStatusId: null,
      requiredRoleIds: ['role-sales-rep'],
    });
    expect(
      await screen.findByText(/Required when adding a lead · Synthetic role B/),
    ).toBeInTheDocument();

    // Reopening shows what is stored, not an empty picker.
    fireEvent.click(screen.getByRole('button', { name: 'Edit rule' }));
    const reopened = screen.getByRole('group', { name: /for these roles/ });
    expect(await within(reopened).findByLabelText('Synthetic role B')).toBeChecked();
    expect(within(reopened).getByLabelText('Synthetic role A')).not.toBeChecked();

    // Switching away drops the roles from the request — the API refuses them
    // on any other requirement.
    fireEvent.change(screen.getByLabelText(/^Requirement/), { target: { value: 'optional' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Field rule' }));
    await waitFor(() => expect(putBodies).toHaveLength(2));
    expect(putBodies[1]).toEqual({ requirement: 'optional', requiredFromStatusId: null });
  });
});
