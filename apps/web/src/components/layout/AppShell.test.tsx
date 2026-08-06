import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { AuthProvider } from '../../app/AuthContext';
import { PreferencesProvider } from '../../app/preferences';
import { usePageChrome } from '../../app/page-chrome';
import { createSession, setCookieHeader } from '../../mocks/session';
import { server } from '../../test/setup';
import { AppShell } from './AppShell';

/** A stand-in route that declares whatever refresh keys a test needs. */
function StubPage({ keys, label }: { keys: string[][]; label: string }) {
  usePageChrome(label, keys);
  return <p>{label} content</p>;
}

function renderShell(page: React.ReactNode = <StubPage keys={[['board']]} label="Board" />) {
  document.cookie = setCookieHeader(createSession('user-admin'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/stub']}>
        <AuthProvider>
          <PreferencesProvider>
            <Routes>
              <Route element={<AppShell title="Wellsure CRM" />}>
                <Route path="/stub" element={page} />
              </Route>
            </Routes>
          </PreferencesProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

describe('app shell', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  it('collapses the sidebar and remembers it across a remount', async () => {
    const first = renderShell();

    const toggle = await screen.findByRole('button', { name: 'Collapse sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);

    await waitFor(() => expect(localStorage.getItem('falcon.ui.sidebarCollapsed')).toBe('true'));
    first.unmount();

    renderShell();
    expect(await screen.findByRole('button', { name: 'Expand sidebar' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('keeps every nav item reachable by name while collapsed', async () => {
    localStorage.setItem('falcon.ui.sidebarCollapsed', 'true');
    renderShell();

    // Labels are visually hidden, not removed.
    expect(await screen.findByRole('link', { name: 'Sellers' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Board' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  it('opens the mobile drawer expanded even when the rail is collapsed', async () => {
    localStorage.setItem('falcon.ui.sidebarCollapsed', 'true');
    renderShell();

    fireEvent.click(await screen.findByRole('button', { name: 'Open navigation menu' }));

    // Two sidebars now exist; the drawer one must show its wordmark, which the
    // collapsed rail hides.
    await waitFor(() => expect(screen.getAllByText('WELLSURE').length).toBe(1));
    expect(screen.getByRole('button', { name: 'Close navigation menu' })).toBeInTheDocument();
  });

  it('still labels Tasks and Finance as unbuilt', async () => {
    renderShell();

    expect(await screen.findByText('Coming soon')).toBeInTheDocument();
    // The label is an inner span; the disabled state lives on its wrapper.
    expect(screen.getByText('Tasks').closest('[aria-disabled]')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByText('Finance').closest('[aria-disabled]')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // Not links — there is nothing behind them.
    expect(screen.queryByRole('link', { name: 'Tasks' })).not.toBeInTheDocument();
  });

  it('refreshes only the query keys the active route declared', async () => {
    let boardCalls = 0;
    let sellerCalls = 0;
    server.use(
      http.get('/api/v1/leads', () => {
        boardCalls += 1;
        return HttpResponse.json({ total: 0, rows: [] });
      }),
    );

    const { client } = renderShell();
    await screen.findByText('Board content');

    // Two live queries: one the route declared, one it did not.
    await client.fetchQuery({
      queryKey: ['board'],
      queryFn: () => {
        boardCalls += 1;
        return 'board';
      },
    });
    await client.fetchQuery({
      queryKey: ['sellers'],
      queryFn: () => {
        sellerCalls += 1;
        return 'sellers';
      },
    });

    const boardBefore = boardCalls;
    const sellersBefore = sellerCalls;

    fireEvent.click(screen.getByRole('button', { name: "Refresh this page's data" }));

    await waitFor(() => expect(client.getQueryState(['board'])?.isInvalidated ?? false).toBe(true));
    // The undeclared key is untouched — refresh is scoped, not a cache wipe.
    expect(client.getQueryState(['sellers'])?.isInvalidated ?? false).toBe(false);
    expect(sellerCalls).toBe(sellersBefore);
    expect(boardCalls).toBeGreaterThanOrEqual(boardBefore);
  });

  it('disables refresh on a route that declares no keys', async () => {
    renderShell(<StubPage keys={[]} label="Settings" />);

    await screen.findByText('Settings content');
    expect(screen.getByRole('button', { name: "Refresh this page's data" })).toBeDisabled();
  });

  it('shows the active route title in the topbar', async () => {
    renderShell();

    expect(await screen.findByRole('heading', { name: 'Board' })).toBeInTheDocument();
  });
});
