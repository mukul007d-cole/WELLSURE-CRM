import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../app/AuthContext';
import { createSession, setCookieHeader } from '../../mocks/session';
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
