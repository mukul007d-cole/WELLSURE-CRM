import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../app/AuthContext';
import { createSession, setCookieHeader } from '../../mocks/session';
import { server } from '../../test/setup';
import { RoleDetailPage } from './RoleDetailPage';

describe('Role full-replacement editor', () => {
  afterEach(() => vi.restoreAllMocks());
  it('keeps checkbox changes local and sends one complete set only on Save', async () => {
    const token = createSession('user-admin');
    document.cookie = setCookieHeader(token);
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input, init) => originalFetch(input, init));
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/admin/roles/role-admin']}>
          {/* Saving now re-reads the signed-in user's own grants, so the page
              needs the auth provider it gets in the real route tree. */}
          <AuthProvider>
            <Routes>
              <Route path="/admin/roles/:roleId" element={<RoleDetailPage />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const [checkbox] = await screen.findAllByRole('checkbox', { name: 'view' });
    if (!checkbox) throw new Error('Expected a view permission checkbox');
    fireEvent.click(checkbox);
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Save feature permissions' }));
    await vi.waitFor(() =>
      expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1),
    );
  });

  /**
   * ADR-0022: the mocked catalog marks only `leads:view`/`leads:edit` as
   * scoped (`create`/`export` are not, matching the real catalog's own
   * mix). A real, functioning selector should render only for the former;
   * the latter gets a fixed label instead, never a control that would
   * silently do nothing.
   */
  it('shows a scope selector only for actions the server actually checks against a record', async () => {
    document.cookie = setCookieHeader(createSession('user-admin'));
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/admin/roles/role-admin']}>
          <AuthProvider>
            <Routes>
              <Route path="/admin/roles/:roleId" element={<RoleDetailPage />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByRole('checkbox', { name: 'export' });
    expect(screen.getByLabelText('Leads view scope')).toBeInTheDocument();
    expect(screen.getByLabelText('Leads edit scope')).toBeInTheDocument();
    expect(screen.queryByLabelText('Leads create scope')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Leads export scope')).not.toBeInTheDocument();
    expect(screen.getAllByText('Always organization-wide').length).toBeGreaterThanOrEqual(2);
  });

  it('normalizes a freshly-granted unscoped action to ORGANIZATION on save, not the checkbox handler default', async () => {
    // role-sales-rep starts with only `leads:view` (SELF) granted — `create`
    // (unscoped, per the mocked catalog) is not yet granted, so checking it
    // exercises `setPermission`'s own default scope (`SELF`), which
    // `normalizeScopes` must then correct at save time.
    document.cookie = setCookieHeader(createSession('user-admin'));
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input, init) => originalFetch(input, init));
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/admin/roles/role-sales-rep']}>
          <AuthProvider>
            <Routes>
              <Route path="/admin/roles/:roleId" element={<RoleDetailPage />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // "create" is ambiguous across modules — scope the query to the Leads
    // fieldset specifically.
    const leadsLegend = await screen.findByText('Leads');
    const leadsFieldset = leadsLegend.closest('fieldset');
    if (!leadsFieldset) throw new Error('Expected a Leads fieldset');
    const createCheckbox = within(leadsFieldset).getByRole('checkbox', { name: 'create' });
    expect(createCheckbox).not.toBeChecked();
    fireEvent.click(createCheckbox); // grant leads:create — unscoped, no selector to set a scope on
    fireEvent.click(screen.getByRole('button', { name: 'Save feature permissions' }));

    await vi.waitFor(() => {
      const put = fetchSpy.mock.calls.find(([, init]) => init?.method === 'PUT');
      expect(put).toBeDefined();
    });
    const [, init] = fetchSpy.mock.calls.find(([, i]) => i?.method === 'PUT')!;
    const body = JSON.parse(init!.body as string) as {
      permissions: Array<{ module: string; action: string; scope: string }>;
    };
    const createRow = body.permissions.find(
      (row) => row.module === 'leads' && row.action === 'create',
    );
    expect(createRow?.scope).toBe('ORGANIZATION');
    // The already-scoped `leads:view` grant is untouched by normalization.
    const viewRow = body.permissions.find((row) => row.module === 'leads' && row.action === 'view');
    expect(viewRow?.scope).toBe('SELF');
  });
});

function renderRole(roleId: string) {
  document.cookie = setCookieHeader(createSession('user-admin'));
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[`/admin/roles/${roleId}`]}>
        <AuthProvider>
          <Routes>
            <Route path="/admin/roles/:roleId" element={<RoleDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Records every PUT body per path, so a test can read what one Save sent. */
function capturePuts() {
  const originalFetch = globalThis.fetch;
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input, init) => originalFetch(input, init));
  return (pathSuffix: string) =>
    spy.mock.calls
      .filter(
        ([input, init]) =>
          init?.method === 'PUT' &&
          (typeof input === 'string' ? input : String(input)).endsWith(pathSuffix),
      )
      .map(([, init]) => JSON.parse(init!.body as string) as Record<string, unknown>);
}

/**
 * The mock catalog predates Phase 24; the real one now carries the
 * REPORTING_ROLES scope and the `bypass_status_rules` action (ADR-0025/0026).
 */
function usePhase24Catalog() {
  server.use(
    http.get('/api/v1/permissions/catalog', () =>
      HttpResponse.json({
        modules: [
          {
            module: 'leads',
            label: 'Leads',
            actions: ['view', 'create', 'edit', 'export', 'bypass_status_rules'],
            scopedActions: ['view', 'edit'],
          },
        ],
        supportedScopes: ['SELF', 'TEAM', 'DEPARTMENT', 'ORGANIZATION', 'REPORTING_ROLES'],
      }),
    ),
  );
}

function section(title: string): HTMLElement {
  const element = screen.getByRole('heading', { name: title }).closest('section');
  if (!element) throw new Error(`Expected a "${title}" section`);
  return element;
}

describe('Role reporting lines (ADR-0025)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('offers every other active role and saves the ticked set', async () => {
    const puts = capturePuts();
    renderRole('role-sales-rep');

    await screen.findByRole('heading', { name: 'Reports to' });
    const reportsTo = section('Reports to');
    expect(
      within(reportsTo).getByText(/see leads owned by users of every role that reports to it/),
    ).toBeInTheDocument();
    const other = await within(reportsTo).findByRole('checkbox', { name: 'Synthetic role A' });
    // A role is never offered as its own manager.
    expect(
      within(reportsTo).queryByRole('checkbox', { name: 'Synthetic role B' }),
    ).not.toBeInTheDocument();

    fireEvent.click(other);
    fireEvent.click(within(reportsTo).getByRole('button', { name: 'Save reporting lines' }));

    await vi.waitFor(() =>
      expect(puts('/roles/role-sales-rep/reporting-lines')).toEqual([
        { reportsToRoleIds: ['role-admin'] },
      ]),
    );
  });

  it('shows why the server refused a cycle beside the reporting lines', async () => {
    server.use(
      http.put('/api/v1/roles/:id/reporting-lines', () =>
        HttpResponse.json({ error: 'validation_error' }, { status: 400 }),
      ),
    );
    renderRole('role-sales-rep');

    const other = await screen.findByRole('checkbox', { name: 'Synthetic role A' });
    fireEvent.click(other);
    fireEvent.click(screen.getByRole('button', { name: 'Save reporting lines' }));

    const alert = await within(section('Reports to')).findByRole('alert');
    expect(alert).toHaveTextContent(/cycle/);
    // The edit survives the refusal so it can be corrected, not retyped.
    expect(other).toBeChecked();
  });
});

describe('Role scopes and actions added in Phase 24', () => {
  afterEach(() => vi.restoreAllMocks());

  it('offers Reporting roles as a scope, explains it, and saves it', async () => {
    usePhase24Catalog();
    const puts = capturePuts();
    renderRole('role-sales-rep');

    const viewScope = await screen.findByLabelText('Leads view scope');
    expect(within(viewScope).getByRole('option', { name: 'Reporting roles' })).toHaveValue(
      'REPORTING_ROLES',
    );
    expect(screen.getByText(/Reporting roles means users of every role/)).toBeInTheDocument();

    fireEvent.change(viewScope, { target: { value: 'REPORTING_ROLES' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save feature permissions' }));

    await vi.waitFor(() => expect(puts('/roles/role-sales-rep/permissions')).toHaveLength(1));
    const [body] = puts('/roles/role-sales-rep/permissions') as Array<{
      permissions: Array<{ module: string; action: string; scope: string }>;
    }>;
    expect(body!.permissions.find((row) => row.action === 'view')?.scope).toBe('REPORTING_ROLES');
  });

  it('labels the status-rules bypass for people rather than by its catalog key', async () => {
    usePhase24Catalog();
    renderRole('role-sales-rep');

    expect(await screen.findByRole('checkbox', { name: 'Bypass status rules' })).toBeInTheDocument();
  });
});

describe('Journey-limited grants (ADR-0026)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('limits one granted action to chosen journeys and sends the limit on save', async () => {
    usePhase24Catalog();
    const puts = capturePuts();
    renderRole('role-sales-rep');

    // Only a granted row has a limit to set; role-sales-rep holds `leads:view` only.
    const trigger = await screen.findByRole('button', {
      name: 'Leads view journeys: Only in journeys…',
    });
    expect(screen.queryByRole('button', { name: /^Leads edit journeys/ })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    const panel = screen.getByRole('group', { name: 'Leads view journeys' });
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Journey Beta' }));
    expect(trigger).toHaveAccessibleName('Leads view journeys: Only in Journey Beta');

    fireEvent.click(screen.getByRole('button', { name: 'Save feature permissions' }));
    await vi.waitFor(() => expect(puts('/roles/role-sales-rep/permissions')).toHaveLength(1));
    const [body] = puts('/roles/role-sales-rep/permissions') as Array<{
      permissions: Array<{ action: string; journeyIds?: string[] }>;
    }>;
    expect(body!.permissions.find((row) => row.action === 'view')?.journeyIds).toEqual([
      'journey-beta',
    ]);
  });

  it('keeps an existing journey limit when some other grant is changed and saved', async () => {
    usePhase24Catalog();
    server.use(
      http.get('/api/v1/roles/:id', () =>
        HttpResponse.json({
          id: 'role-sales-rep',
          key: 'role_sales_rep',
          name: 'Synthetic role B',
          active: true,
          version: 1,
          permissions: [
            { module: 'leads', action: 'view', scope: 'SELF', journeyIds: ['journey-gamma'] },
            { module: 'leads', action: 'edit', scope: 'SELF', journeyIds: [] },
          ],
          journeyAccess: [{ journeyId: 'journey-alpha' }, { journeyId: 'journey-gamma' }],
          fieldVisibility: [],
        }),
      ),
    );
    const puts = capturePuts();
    renderRole('role-sales-rep');

    expect(
      await screen.findByRole('button', { name: 'Leads view journeys: Only in Journey Gamma' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'export' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save feature permissions' }));

    await vi.waitFor(() => expect(puts('/roles/role-sales-rep/permissions')).toHaveLength(1));
    const [body] = puts('/roles/role-sales-rep/permissions') as Array<{
      permissions: Array<{ action: string; journeyIds?: string[] }>;
    }>;
    expect(body!.permissions.find((row) => row.action === 'view')?.journeyIds).toEqual([
      'journey-gamma',
    ]);
    expect(body!.permissions.find((row) => row.action === 'export')).toBeDefined();
  });

  it("offers only the role's accessible journeys as limits", async () => {
    usePhase24Catalog();
    renderRole('role-sales-rep');

    // Untick a journey from Journey access (unsaved) — the limit picker follows.
    const access = section('Journey access');
    fireEvent.click(await within(access).findByRole('checkbox', { name: 'Journey Alpha' }));
    fireEvent.click(screen.getByRole('button', { name: /^Leads view journeys/ }));

    const panel = screen.getByRole('group', { name: 'Leads view journeys' });
    expect(within(panel).queryByRole('checkbox', { name: 'Journey Alpha' })).not.toBeInTheDocument();
    expect(within(panel).getByRole('checkbox', { name: 'Journey Beta' })).toBeInTheDocument();
  });
});
