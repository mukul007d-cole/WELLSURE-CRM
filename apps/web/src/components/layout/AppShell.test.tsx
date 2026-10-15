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
import { NotFoundPage } from '../../pages/not-found/NotFoundPage';
import { AppShell } from './AppShell';

/** A stand-in route that declares whatever refresh keys a test needs. */
function StubPage({ keys, label }: { keys: string[][]; label: string }) {
  usePageChrome(label, keys);
  return <p>{label} content</p>;
}

/** Throws while `shouldThrow()` is true — lets a test flip it and retry. */
function FlakyPage({ shouldThrow }: { shouldThrow: () => boolean }) {
  if (shouldThrow()) throw new Error('synthetic render failure');
  return <p>Recovered content</p>;
}

function renderShell(
  page: React.ReactNode = <StubPage keys={[['board']]} label="Board" />,
  initialPath = '/stub',
  userId = 'user-admin',
) {
  document.cookie = setCookieHeader(createSession(userId));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <AuthProvider>
          <PreferencesProvider>
            <Routes>
              <Route element={<AppShell title="Wellsure CRM" />}>
                <Route path="/stub" element={page} />
                {/* Mirrors App.tsx's own nested catch-all exactly. */}
                <Route path="*" element={<NotFoundPage />} />
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
    // Waits on capabilities, which Sellers and Dashboard never needed.
    expect(await screen.findByRole('link', { name: 'Admin' })).toBeInTheDocument();
    // The due count joins the name, so the collapsed rail still announces it.
    expect(await screen.findByRole('link', { name: 'Follow-ups, 1 due' })).toBeInTheDocument();
    // The board is a view of the sellers module now, reached from its view
    // switcher rather than competing for a sidebar row of its own.
    expect(screen.queryByRole('link', { name: 'Board' })).not.toBeInTheDocument();
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

  it('still labels Finance as unbuilt', async () => {
    renderShell();

    expect(await screen.findByText('Coming soon')).toBeInTheDocument();
    // The label is an inner span; the disabled state lives on its wrapper.
    expect(screen.getByText('Finance').closest('[aria-disabled]')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // Not a link — there is nothing behind it.
    expect(screen.queryByRole('link', { name: 'Finance' })).not.toBeInTheDocument();
  });

  it('links Follow-ups with a badge counting overdue and today', async () => {
    renderShell();

    // The seed has one overdue follow-up and one upcoming; only the first is due.
    const link = await screen.findByRole('link', { name: 'Follow-ups, 1 due' });
    expect(link).toHaveAttribute('href', '/follow-ups');
    expect(screen.queryByText('Tasks')).not.toBeInTheDocument();
  });

  it('folds every admin area into one Admin entry', async () => {
    renderShell();

    expect(await screen.findByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
    // The areas themselves are reached from the admin area's own navigation.
    for (const name of ['Journeys', 'Fields', 'Import leads', 'Campaigns', 'Roles & permissions']) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    }
    for (const heading of ['Configuration', 'Engagement', 'People & access']) {
      expect(screen.queryByText(heading)).not.toBeInTheDocument();
    }
  });

  it('hides Admin from someone who can open no admin area', async () => {
    renderShell(undefined, '/stub', 'user-rep');

    // Signed in, with capabilities read — only then does the absence mean anything.
    await screen.findByRole('button', { name: /Aman Verma/ });
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
    expect(screen.queryByText('Administration')).not.toBeInTheDocument();
  });

  it('keeps Admin lit on an admin area outside /admin', async () => {
    renderShell(undefined, '/import');

    const link = await screen.findByRole('link', { name: 'Admin' });
    expect(link).toHaveClass('border-gold');
  });

  it('moves Settings from the sidebar into the account menu', async () => {
    renderShell();

    const account = await screen.findByRole('button', { name: /Priya Shah/ });
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();

    fireEvent.click(account);
    const settings = screen.getByRole('link', { name: 'Settings' });
    expect(settings).toHaveAttribute('href', '/settings');

    // Choosing it navigates and closes the menu behind it.
    fireEvent.click(settings);
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /Priya Shah/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
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

  it('catches a routed page crash instead of leaving a blank screen', async () => {
    renderShell(<FlakyPage shouldThrow={() => true} />);

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    // The nav survives the crash — recovery doesn't require a manual refresh.
    expect(screen.getByRole('link', { name: 'Sellers' })).toBeInTheDocument();
  });

  it('recovers on "Try again" once the underlying error condition clears', async () => {
    let broken = true;
    renderShell(<FlakyPage shouldThrow={() => broken} />);
    await screen.findByText('Something went wrong');

    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Recovered content')).toBeInTheDocument();
  });

  it('shows a 404 page, nav intact, for a path nothing else matches', async () => {
    renderShell(undefined, '/this/path/does/not/exist');

    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    // The nav survives too — a bad link doesn't strand the user off it.
    expect(screen.getByRole('link', { name: 'Sellers' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Sellers' })).toHaveAttribute(
      'href',
      '/sellers',
    );
  });
});
