import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { AuthProvider } from '../../app/AuthContext';
import { JOURNEYS, LEADS } from '../../mocks/fixtures';
import { createSession, setCookieHeader } from '../../mocks/session';
import { server } from '../../test/setup';
import { LeadFormPage } from './LeadFormPage';

const JOURNEY = JOURNEYS[0]!;

/** Echoes the id so a navigation to /sellers/undefined is unmistakable. */
function SellerDetailStub() {
  const { sellerId } = useParams<{ sellerId: string }>();
  return <p>Seller detail: {sellerId}</p>;
}

function renderForm(userId: string, path: string, route: string) {
  document.cookie = setCookieHeader(createSession(userId));
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route path={route} element={<LeadFormPage />} />
            <Route path="/sellers/:sellerId" element={<SellerDetailStub />} />
            <Route path="/sellers" element={<p>Seller list</p>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const renderCreate = (userId = 'user-admin') => renderForm(userId, '/sellers/new', '/sellers/new');

/**
 * The control starts as a text input while the types load and is replaced by a
 * select once they arrive, so tests must wait for an option rather than
 * holding on to the element they first found.
 */
/**
 * react-hook-form re-seeds this form from `values` when the dynamic field list
 * arrives, which wipes anything typed before then. Wait for the fields to land
 * before filling anything in.
 */
async function waitForFormReady() {
  await screen.findByLabelText(/Company Name/);
}

async function chooseJourney() {
  // The select exists before its options load, and setting a value that has no
  // matching option is silently ignored — so wait for the option itself.
  await screen.findByRole('option', { name: JOURNEY.name });
  fireEvent.change(screen.getByLabelText(/^Journey/), { target: { value: JOURNEY.id } });
}

async function chooseAssignmentType(value: string) {
  await screen.findByRole('option', { name: value });
  fireEvent.change(screen.getByLabelText(/^Assign as/), { target: { value } });
}
const renderEdit = (userId: string, leadId: string) =>
  renderForm(userId, `/sellers/${leadId}/edit`, '/sellers/:sellerId/edit');

/** Captures the body of whichever lead mutation the form issues. */
function captureCreate() {
  const bodies: { assignments: { assignmentType: string; userId: string }[] }[] = [];
  server.use(
    http.post('/api/v1/leads', async ({ request }) => {
      const body = (await request.json()) as (typeof bodies)[number];
      bodies.push(body);
      // Mirrors the API: raw rows, no top-level id.
      return HttpResponse.json(
        { lead: { id: 'lead-new', name: 'Synthetic Co' }, process: { id: 'pi-new' } },
        { status: 201 },
      );
    }),
  );
  return bodies;
}

function capturePatch() {
  const bodies: { assignmentTypes?: string[] }[] = [];
  server.use(
    http.patch('/api/v1/leads/:id', async ({ request }) => {
      const body = (await request.json()) as (typeof bodies)[number];
      bodies.push(body);
      return HttpResponse.json({ id: 'lead-1', processInstances: [] });
    }),
  );
  return bodies;
}

describe('lead form assignment types', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  it('offers the assignment types actually in use on the chosen journey', async () => {
    renderCreate();

    await chooseJourney();

    // Comes from the journey document, not a literal in the bundle.
    expect(await screen.findByRole('option', { name: 'owner' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Assign as/).tagName).toBe('SELECT');
  });

  it('sends the configured assignment type rather than a hardcoded literal', async () => {
    const bodies = captureCreate();
    // A journey whose assignments use a type that is emphatically not "owner",
    // so a regression to the literal cannot pass this test.
    server.use(
      http.get('/api/v1/journeys/:id', () =>
        HttpResponse.json({
          ...JOURNEY,
          active: true,
          statuses: [
            {
              id: 'status-default',
              journeyId: JOURNEY.id,
              key: 'new',
              name: 'New',
              outcomeType: 'open',
              behaviorType: 'default',
              active: true,
              sortOrder: 0,
              isDefaultOnCreate: true,
            },
          ],
          assignmentTypes: ['synthetic-relationship-lead'],
        }),
      ),
    );

    renderCreate();
    await waitForFormReady();

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Synthetic Co' } });
    await chooseJourney();
    await chooseAssignmentType('synthetic-relationship-lead');
    fireEvent.click(screen.getByRole('button', { name: /create seller/i }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]!.assignments).toEqual([
      { assignmentType: 'synthetic-relationship-lead', userId: 'user-admin' },
    ]);
    expect(JSON.stringify(bodies[0])).not.toContain('"owner"');
  });

  it('lets the first assignment type on an empty journey be named', async () => {
    server.use(
      http.get('/api/v1/journeys/:id', () =>
        HttpResponse.json({ ...JOURNEY, active: true, statuses: [], assignmentTypes: [] }),
      ),
    );

    renderCreate();
    await chooseJourney();

    // No types yet, so a free-text box rather than an empty dropdown.
    const input = await screen.findByLabelText(/^Assign as/);
    await waitFor(() => expect(input).not.toBeDisabled());
    expect(input.tagName).toBe('INPUT');
    expect(screen.getByText(/name the first one/i)).toBeInTheDocument();
  });

  it('refuses to create without an assignment type instead of inventing one', async () => {
    const bodies = captureCreate();
    renderCreate();
    await waitForFormReady();

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Synthetic Co' } });
    await chooseJourney();
    // Types are available, but none is chosen.
    await screen.findByRole('option', { name: 'owner' });
    fireEvent.click(screen.getByRole('button', { name: /create seller/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/assigned as/i);
    expect(bodies).toHaveLength(0);
  });

  it('navigates to the created seller rather than /sellers/undefined', async () => {
    // POST /leads returns { lead, process }, so reading `id` off the top level
    // produced undefined and a GET /leads/undefined that 500s on a non-UUID.
    captureCreate();
    renderCreate();
    await waitForFormReady();

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Synthetic Co' } });
    await chooseJourney();
    await chooseAssignmentType('owner');
    fireEvent.click(screen.getByRole('button', { name: /create seller/i }));

    expect(await screen.findByText('Seller detail: lead-new')).toBeInTheDocument();
  });

  it('refuses to submit against a journey with no active statuses', async () => {
    const bodies = captureCreate();
    server.use(
      http.get('/api/v1/journeys/:id', () =>
        HttpResponse.json({ ...JOURNEY, active: true, statuses: [], assignmentTypes: ['owner'] }),
      ),
    );

    renderCreate();
    await waitForFormReady();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Synthetic Co' } });
    await chooseJourney();
    await chooseAssignmentType('owner');
    fireEvent.click(screen.getByRole('button', { name: /create seller/i }));

    // Named plainly instead of a bare validation_error from the server.
    expect(await screen.findByRole('alert')).toHaveTextContent(/no active statuses/i);
    expect(bodies).toHaveLength(0);
  });

  it('requires an explicit status when the journey has no default-on-create', async () => {
    const bodies = captureCreate();
    server.use(
      http.get('/api/v1/journeys/:id', () =>
        HttpResponse.json({
          ...JOURNEY,
          active: true,
          assignmentTypes: ['owner'],
          statuses: [
            {
              id: 'status-no-default',
              journeyId: JOURNEY.id,
              key: 'triage',
              name: 'Triage',
              outcomeType: 'open',
              behaviorType: 'default',
              active: true,
              sortOrder: 0,
              isDefaultOnCreate: false,
            },
          ],
        }),
      ),
    );

    renderCreate();
    await waitForFormReady();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Synthetic Co' } });
    await chooseJourney();
    await chooseAssignmentType('owner');

    // No "use journey default" on offer, because there is no default.
    await screen.findByRole('option', { name: 'Triage' });
    expect(screen.queryByRole('option', { name: 'Use journey default' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /create seller/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/choose a status/i);
    expect(bodies).toHaveLength(0);
  });

  /**
   * The actual defect. assignmentTypes feeds the authorization
   * record-predicate; omitting it sends an empty array, which matches no
   * assignment and so denies any role narrower than ORGANIZATION.
   */
  it('lets a SELF-scoped user save an edit without a 403', async () => {
    const bodies = capturePatch();

    renderEdit('user-rep', 'lead-1');

    const name = await screen.findByLabelText(/^Name/);
    await waitFor(() => expect((name as HTMLInputElement).value).not.toBe(''));
    fireEvent.change(name, { target: { value: 'Renamed by the rep' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    // The lead's real assignment types travel with the request.
    expect(bodies[0]!.assignmentTypes).toEqual(['owner']);
    expect(await screen.findByText(/^Seller detail: lead-1$/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('still refuses a SELF-scoped edit that omits assignment types', async () => {
    // Guards the mock's fidelity to assignmentScopeAllowsLead: the previous
    // test only proves something if the omitted-types case genuinely 403s.
    document.cookie = setCookieHeader(createSession('user-rep'));

    const response = await fetch('/api/v1/leads/lead-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        processInstanceId: 'pi-lead-1',
        journeyId: JOURNEY.id,
        name: 'Renamed without assignment types',
      }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
  });

  /**
   * The actual defect. `toFieldValues` keyed its output by `field.key`
   * ("company_name") rather than `field.id`, and the real API's
   * `field_values` column is addressed by id everywhere — so this request
   * would have thrown a 500 against the real backend (Postgres rejecting a
   * non-uuid id) and, even here against the more forgiving mock, would have
   * left the lead's real `field-company` value untouched while adding a
   * dead `company_name` key beside it. This exercises the real mock handler
   * (no stub) end to end, so it catches drift on either side of that
   * boundary, not just a client-side crash.
   */
  it('saves an Additional field edit keyed by the Field’s id, not its key', async () => {
    renderEdit('user-admin', 'lead-1');
    await waitForFormReady();

    const companyField = screen.getByLabelText(/Company Name/);
    fireEvent.change(companyField, { target: { value: 'Renamed via Additional field' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(screen.getByText(/^Seller detail: lead-1$/)).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    const lead = LEADS.find((row) => row.id === 'lead-1')!;
    expect(lead.fieldValues['field-company']).toBe('Renamed via Additional field');
    expect(lead.fieldValues).not.toHaveProperty('company_name');
  });

  /**
   * The real API returns a value for a Field id only when the caller's query
   * string names it (see `resolveFieldDecision` in the permission engine) —
   * this suite's mock GET handler doesn't enforce that rule, so it can't
   * catch a client that forgets to ask. This test enforces the real rule
   * directly: if `sellersApi.detail` ever stopped sending
   * `requestedFieldIds`, every Additional field would reopen blank, looking
   * exactly like the earlier save never took — the bug this closes.
   */
  it('prefills a saved Additional field when the edit form reopens', async () => {
    server.use(
      http.get('/api/v1/leads/:id', ({ request }) => {
        const requested = new Set(
          (new URL(request.url).searchParams.get('requestedFieldIds') ?? '')
            .split(',')
            .filter(Boolean),
        );
        const allValues: Record<string, unknown> = { 'field-company': 'Existing Company Value' };
        return HttpResponse.json({
          id: 'lead-1',
          name: 'Vantage Retail Co',
          phone: null,
          email: null,
          fieldValues: Object.fromEntries(
            Object.entries(allValues).filter(([id]) => requested.has(id)),
          ),
          processInstances: [
            {
              processInstanceId: 'pi-lead-1',
              journeyId: JOURNEY.id,
              active: true,
              assignments: [],
              journey: { id: JOURNEY.id, key: JOURNEY.key, name: JOURNEY.name },
              currentStatus: {
                id: 'status-1',
                key: 'new',
                name: 'New',
                outcomeType: 'open',
                behaviorType: 'default',
              },
            },
          ],
        });
      }),
    );
    renderEdit('user-admin', 'lead-1');
    await waitForFormReady();

    expect(screen.getByLabelText(/Company Name/)).toHaveValue('Existing Company Value');
  });

  it('lets an ORGANIZATION-scoped user edit regardless, matching the engine', async () => {
    // ORGANIZATION scope short-circuits the record check, so the same omission
    // is harmless there — which is why this defect stayed hidden.
    document.cookie = setCookieHeader(createSession('user-admin'));

    const response = await fetch('/api/v1/leads/lead-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        processInstanceId: 'pi-lead-1',
        journeyId: JOURNEY.id,
        name: 'Renamed by an org-scoped user',
      }),
    });

    expect(response.status).toBe(200);
  });
});

describe('lead form editMode rendering', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  function stubFields(
    fields: Array<{
      id: string;
      key: string;
      label: string;
      type: string;
      editMode: string;
      section?: string | null;
    }>,
  ) {
    server.use(
      http.get('/api/v1/fields', () =>
        HttpResponse.json(
          fields.map((field) => ({
            id: field.id,
            key: field.key,
            name: field.label,
            fieldType: field.type,
            editMode: field.editMode,
            section: field.section ?? null,
            source: 'manual',
            active: true,
          })),
        ),
      ),
    );
  }

  it('renders a locked field as an editable control before it has a value', async () => {
    stubFields([
      { id: 'field-locked', key: 'gst', label: 'GST Number', type: 'text', editMode: 'locked' },
    ]);
    renderCreate();
    expect(await screen.findByLabelText('GST Number')).not.toBeDisabled();
  });

  it('renders a locked field read-only once it already has a value', async () => {
    stubFields([
      { id: 'field-locked', key: 'gst', label: 'GST Number', type: 'text', editMode: 'locked' },
    ]);
    server.use(
      http.get('/api/v1/leads/:id', () =>
        HttpResponse.json({
          id: 'lead-1',
          name: 'Vantage Retail Co',
          phone: null,
          email: null,
          fieldValues: { 'field-locked': 'GSTIN123' },
          processInstances: [
            {
              processInstanceId: 'pi-lead-1',
              journeyId: JOURNEY.id,
              active: true,
              assignments: [],
              journey: { id: JOURNEY.id, key: JOURNEY.key, name: JOURNEY.name },
              currentStatus: {
                id: 'status-1',
                key: 'new',
                name: 'New',
                outcomeType: 'open',
                behaviorType: 'default',
              },
            },
          ],
        }),
      ),
    );
    renderEdit('user-admin', 'lead-1');
    const input = await screen.findByLabelText('GST Number');
    expect(input).toBeDisabled();
    expect(input).toHaveValue('GSTIN123');
  });

  it('renders calculated and system fields as read-only from the start', async () => {
    stubFields([
      {
        id: 'field-calc',
        key: 'deal_value',
        label: 'Deal Value',
        type: 'number',
        editMode: 'calculated',
      },
      {
        id: 'field-sys',
        key: 'created_channel',
        label: 'Created Channel',
        type: 'text',
        editMode: 'system',
      },
    ]);
    renderCreate();
    expect(await screen.findByLabelText('Deal Value')).toBeDisabled();
    expect(screen.getByLabelText('Created Channel')).toBeDisabled();
  });

  it('never renders an editable control for an api-only field', async () => {
    stubFields([
      {
        id: 'field-api',
        key: 'external_id',
        label: 'External Id',
        type: 'text',
        editMode: 'api-only',
      },
      { id: 'field-manual', key: 'notes', label: 'Notes', type: 'textarea', editMode: 'manual' },
    ]);
    renderCreate();
    await screen.findByLabelText('Notes');
    expect(screen.queryByLabelText('External Id')).not.toBeInTheDocument();
  });

  it('groups Additional details by section, matching the read-only Details tab', async () => {
    stubFields([
      {
        id: 'field-a',
        key: 'field_a',
        label: 'Field A',
        type: 'text',
        editMode: 'manual',
        section: 'Company',
      },
      {
        id: 'field-b',
        key: 'field_b',
        label: 'Field B',
        type: 'text',
        editMode: 'manual',
        section: 'Contact',
      },
    ]);
    renderCreate();
    await screen.findByLabelText('Field A');
    expect(screen.getByText('Company')).toBeInTheDocument();
    expect(screen.getByText('Contact')).toBeInTheDocument();
  });
});
