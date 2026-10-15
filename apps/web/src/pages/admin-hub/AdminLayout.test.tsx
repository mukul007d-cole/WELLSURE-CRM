import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { AuthProvider } from '../../app/AuthContext';
import { PermissionRoute } from '../../app/PermissionRoute';
import { ProtectedRoute } from '../../app/ProtectedRoute';
import { createSession, setCookieHeader } from '../../mocks/session';
import { server } from '../../test/setup';
import { AdminHomePage } from './AdminHomePage';
import { AdminLayout } from './AdminLayout';

/** Replaces the signed-in user's grants with exactly these. */
function grant(...permissions: string[]) {
  server.use(
    http.get('/api/v1/auth/capabilities', () =>
      HttpResponse.json({
        permissions: permissions.map((value) => {
          const [module, action] = value.split(':');
          return { module, action, scope: 'ORGANIZATION' };
        }),
        journeyIds: [],
        fieldVisibility: [],
        hasAccessibleTools: false,
      }),
    ),
  );
}

/** The admin branch of `App.tsx`, with stand-ins for the pages themselves. */
function renderAdmin(initialPath = '/admin') {
  document.cookie = setCookieHeader(createSession('user-admin'));
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[initialPath]}>
        <AuthProvider>
          <Routes>
            {/* Grants are only meaningful once the session check has settled. */}
            <Route element={<ProtectedRoute />}>
              <Route element={<AdminLayout />}>
                <Route path="/admin" element={<AdminHomePage />} />
                <Route element={<PermissionRoute module="users" />}>
                  <Route path="/admin/users" element={<p>Users page</p>} />
                </Route>
                <Route element={<PermissionRoute module="leads" action="import" />}>
                  <Route path="/import" element={<p>Import page</p>} />
                </Route>
              </Route>
              <Route path="/sellers" element={<p>Sellers list</p>} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('admin area', () => {
  beforeEach(() => {
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  it('groups every area in its own navigation for a full admin', async () => {
    renderAdmin();

    const nav = await screen.findByRole('navigation', { name: 'Admin' });
    for (const group of ['Pipeline', 'People', 'Automation', 'Data']) {
      expect(within(nav).getByRole('list', { name: group })).toBeInTheDocument();
    }
    expect(
      within(within(nav).getByRole('list', { name: 'People' }))
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Users', 'Org chart', 'Departments & teams', 'Roles & permissions']);
    // Import keeps its own URL, but belongs here.
    expect(within(nav).getByRole('link', { name: 'Import leads' })).toHaveAttribute(
      'href',
      '/import',
    );
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('hides each area, and each empty group, the user has no grant for', async () => {
    grant('users:view');
    renderAdmin();

    const nav = await screen.findByRole('navigation', { name: 'Admin' });
    expect(within(nav).getByRole('link', { name: 'Users' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Org chart' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Departments & teams' })).toBeInTheDocument();
    // Same group, different grant.
    expect(within(nav).queryByRole('link', { name: 'Roles & permissions' })).toBeNull();
    for (const group of ['Pipeline', 'Automation', 'Data']) {
      expect(within(nav).queryByRole('list', { name: group })).toBeNull();
    }

    // The overview offers exactly the same areas.
    const people = screen.getByRole('region', { name: 'People' });
    expect(within(people).getAllByRole('link')).toHaveLength(3);
    expect(screen.queryByRole('region', { name: 'Pipeline' })).toBeNull();
  });

  it('shows an area reached outside /admin inside the admin frame', async () => {
    grant('leads:import');
    renderAdmin('/import');

    expect(await screen.findByText('Import page')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Admin' });
    expect(within(nav).getByRole('link', { name: 'Import leads' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).queryByRole('link', { name: 'Users' })).toBeNull();
  });

  it('sends someone with no admin area back to Sellers', async () => {
    grant('leads:view');
    renderAdmin();

    expect(await screen.findByText('Sellers list')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Admin' })).toBeNull();
  });
});
