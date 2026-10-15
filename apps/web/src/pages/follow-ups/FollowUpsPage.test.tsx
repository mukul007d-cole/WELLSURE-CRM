import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { AuthProvider } from '../../app/AuthContext';
import { LEADS } from '../../mocks/fixtures';
import { createSession, setCookieHeader } from '../../mocks/session';
import { server } from '../../test/setup';
import { FollowUpsPage } from './FollowUpsPage';
import { relativeDue } from './due-date';

function renderPage(initialPath = '/follow-ups') {
  document.cookie = setCookieHeader(createSession('user-admin'));
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[initialPath]}>
        <AuthProvider>
          <Routes>
            <Route path="/follow-ups" element={<FollowUpsPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const lead = LEADS[0]!;

/** Captures each PATCH body while letting the shared handler apply it. */
function recordPatches(): unknown[] {
  const bodies: unknown[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'PATCH' && new URL(request.url).pathname.startsWith('/api/v1/tasks/'))
      void request
        .clone()
        .json()
        .then((body) => bodies.push(body));
  });
  return bodies;
}

describe('follow-ups page', () => {
  afterEach(() => server.events.removeAllListeners());
  beforeEach(() => {
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  it('lists the overdue follow-up first, and the upcoming one on its own tab', async () => {
    renderPage();

    const panel = await screen.findByRole('tabpanel');
    expect(await within(panel).findByText('Call back about pricing')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: lead.name })).toHaveAttribute(
      'href',
      `/sellers/${lead.id}`,
    );
    // Counts come from the summary, not from the page currently on screen.
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /^Overdue/ })).toHaveTextContent('Overdue1'),
    );
    expect(screen.getByRole('tab', { name: /^Upcoming/ })).toHaveTextContent('Upcoming1');

    fireEvent.click(screen.getByRole('tab', { name: /^Upcoming/ }));
    const upcoming = await screen.findByRole('tabpanel');
    expect(await within(upcoming).findByRole('link', { name: lead.name })).toBeInTheDocument();
    expect(within(upcoming).queryByText('Call back about pricing')).toBeNull();
    expect(
      within(upcoming).getByText(relativeDue(new Date(Date.now() + 3 * 86_400_000).toISOString())),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /^Today/ }));
    expect(await screen.findByText('Nothing else due today')).toBeInTheDocument();
  });

  it('completing a follow-up moves it from Overdue to Done', async () => {
    const patches = recordPatches();
    renderPage();

    const panel = await screen.findByRole('tabpanel');
    await within(panel).findByText('Call back about pricing');
    fireEvent.click(within(panel).getByRole('button', { name: /^Done/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Mark follow-up done' });
    fireEvent.change(within(dialog).getByLabelText('Note'), {
      target: { value: 'Agreed on pricing' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark done' }));

    expect(await screen.findByText('Nothing overdue')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() =>
      expect(patches).toEqual([{ action: 'complete', note: 'Agreed on pricing' }]),
    );
    // The summary was refreshed with the list — the badge no longer counts it.
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /^Overdue/ })).toHaveTextContent('Overdue0'),
    );

    fireEvent.click(screen.getByRole('tab', { name: /^Done/ }));
    const done = await screen.findByRole('tabpanel');
    expect(await within(done).findByText('Agreed on pricing')).toBeInTheDocument();
    expect(within(done).getByRole('button', { name: /^Reopen/ })).toBeInTheDocument();

    fireEvent.click(within(done).getByRole('button', { name: /^Reopen/ }));
    expect(await screen.findByText('Nothing completed yet')).toBeInTheDocument();
  });

  it('reschedules to the chosen time', async () => {
    const patches = recordPatches();
    renderPage();

    const panel = await screen.findByRole('tabpanel');
    await within(panel).findByText('Call back about pricing');
    fireEvent.click(within(panel).getByRole('button', { name: /^Reschedule/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Reschedule follow-up' });
    fireEvent.change(within(dialog).getByLabelText(/New date and time/), {
      target: { value: '2099-01-02T10:30' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reschedule' }));

    expect(await screen.findByText('Nothing overdue')).toBeInTheDocument();
    await waitFor(() =>
      expect(patches).toEqual([
        { action: 'reschedule', dueAt: new Date('2099-01-02T10:30').toISOString() },
      ]),
    );
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /^Upcoming/ })).toHaveTextContent('Upcoming2'),
    );
  });

  it('says when the list was cut short', async () => {
    server.use(
      http.get('/api/v1/tasks', () =>
        HttpResponse.json({ page: 1, pageSize: 25, total: 0, truncated: true, items: [] }),
      ),
    );
    renderPage('/follow-ups?view=upcoming');

    expect(await screen.findByText(/Only your earliest follow-ups/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Upcoming/ })).toHaveAttribute('aria-selected', 'true');
  });
});
