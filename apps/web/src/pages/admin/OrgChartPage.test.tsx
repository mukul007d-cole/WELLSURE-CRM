import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { delay, http, HttpResponse } from 'msw';
import { AuthProvider } from '../../app/AuthContext';
import { PermissionRoute } from '../../app/PermissionRoute';
import { ProtectedRoute } from '../../app/ProtectedRoute';
import { PreferencesProvider } from '../../app/preferences';
import { createSession, setCookieHeader } from '../../mocks/session';
import { server } from '../../test/setup';
import { OrgChartPage } from './OrgChartPage';

function renderOrgChart(userId = 'user-admin') {
  document.cookie = setCookieHeader(createSession(userId));
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/admin/org-chart']}>
        <AuthProvider>
          <PreferencesProvider>
            <Routes>
              {/* ProtectedRoute holds the render until capabilities load —
                  without it PermissionRoute redirects during the checking
                  state, exactly as it would in the real app. */}
              <Route element={<ProtectedRoute />}>
                <Route element={<PermissionRoute module="users" />}>
                  <Route path="/admin/org-chart" element={<OrgChartPage />} />
                </Route>
                <Route path="/sellers" element={<p>Seller list</p>} />
              </Route>
            </Routes>
          </PreferencesProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('org chart', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  it('renders the reporting structure with role and department names', async () => {
    renderOrgChart();

    expect(await screen.findByRole('tree', { name: 'Reporting hierarchy' })).toBeInTheDocument();
    expect(screen.getByText('Alba Fenn')).toBeInTheDocument();
    // Names, never raw ids.
    expect(screen.getAllByText(/Synthetic unit/).length).toBeGreaterThan(0);
    expect(screen.queryByText('department-synthetic')).not.toBeInTheDocument();
  });

  it('waits for every page of users before rendering any of the tree', async () => {
    // Three pages of 25: a tree built from page one alone would wrongly show
    // people as roots because their manager hadn't arrived yet.
    const everyone = Array.from({ length: 60 }, (_, index) => ({
      id: `bulk-${index}`,
      name: `Bulk Person ${String(index).padStart(2, '0')}`,
      email: `bulk${index}@example.test`,
      roleId: 'role-admin',
      departmentId: null,
      managerId: index === 0 ? null : 'bulk-0',
      active: true,
    }));

    server.use(
      http.get('/api/v1/users', async ({ request }) => {
        const url = new URL(request.url);
        const page = Number(url.searchParams.get('page') ?? '1');
        const pageSize = Number(url.searchParams.get('pageSize') ?? '25');
        await delay(40);
        return HttpResponse.json({
          page,
          pageSize,
          total: everyone.length,
          items: everyone.slice((page - 1) * pageSize, page * pageSize),
        });
      }),
    );

    renderOrgChart();

    // Wait for the page itself to mount past the auth spinner first. The
    // heading now lives on the User management shell, so anchor on a control
    // this view owns.
    await screen.findByLabelText('Search people');
    expect(screen.getByText(/loading the full directory/i)).toBeInTheDocument();
    expect(screen.queryByRole('treeitem')).not.toBeInTheDocument();

    expect(await screen.findByText('Bulk Person 00')).toBeInTheDocument();
    // One root, everyone else nested beneath it.
    expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(1);
  });

  it('flags a reporting loop and still lists everyone', async () => {
    server.use(
      http.get('/api/v1/users', () =>
        HttpResponse.json({
          page: 1,
          pageSize: 25,
          total: 2,
          items: [
            {
              id: 'loop-a',
              name: 'Ada Loop',
              email: 'ada@example.test',
              roleId: 'role-admin',
              departmentId: null,
              managerId: 'loop-b',
              active: true,
            },
            {
              id: 'loop-b',
              name: 'Ben Loop',
              email: 'ben@example.test',
              roleId: 'role-admin',
              departmentId: null,
              managerId: 'loop-a',
              active: true,
            },
          ],
        }),
      ),
    );

    renderOrgChart();

    const banner = await screen.findByText(/reporting loop was found/i);
    expect(banner).toHaveTextContent('Ada Loop');
    expect(banner).toHaveTextContent('Ben Loop');
    // Both still render — flat, not swallowed by the loop.
    expect(screen.getAllByRole('treeitem')).toHaveLength(2);
  });

  it('marks a deactivated person and warns about managers outside the set', async () => {
    renderOrgChart();

    expect(await screen.findByText('Emeka Sandoval')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(screen.getByText(/outside the users you can see/i)).toHaveTextContent(
      'Hana Brightwater',
    );
  });

  it('searches, highlights the match, and expands the path to it', async () => {
    renderOrgChart();
    await screen.findByText('Alba Fenn');

    fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'Dara' } });

    expect(await screen.findByText('1 person matches')).toBeInTheDocument();
    const match = screen.getByText('Dara', { selector: 'mark' });
    expect(match).toBeInTheDocument();
    // Ancestors stay visible so the path reads; unrelated branches drop away.
    expect(screen.getByText('Bo Ridley')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Gil Marchetti')).not.toBeInTheDocument());
  });

  it('collapses a branch when its disclosure is toggled', async () => {
    renderOrgChart();
    await screen.findByText('Alba Fenn');

    expect(screen.getByText('Bo Ridley')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: "Collapse Alba Fenn's reports" }));

    await waitFor(() => expect(screen.queryByText('Bo Ridley')).not.toBeInTheDocument());
  });

  it('keeps the tree usable when role names are forbidden', async () => {
    server.use(
      http.get('/api/v1/roles', () => HttpResponse.json({ error: 'forbidden' }, { status: 403 })),
    );

    renderOrgChart();

    expect(await screen.findByText('Alba Fenn')).toBeInTheDocument();
    expect(screen.getAllByText('Role hidden').length).toBeGreaterThan(0);
  });

  it('redirects a user without users:view away from the route', async () => {
    renderOrgChart('user-rep');

    expect(await screen.findByText('Seller list')).toBeInTheDocument();
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
  });
});
