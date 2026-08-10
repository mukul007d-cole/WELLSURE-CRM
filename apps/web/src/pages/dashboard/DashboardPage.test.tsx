import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { AuthProvider } from '../../app/AuthContext';
import { PreferencesProvider } from '../../app/preferences';
import { JOURNEYS } from '../../mocks/fixtures';
import { createSession, setCookieHeader } from '../../mocks/session';
import { server } from '../../test/setup';
import { DashboardPage } from './DashboardPage';

function renderDashboard() {
  document.cookie = setCookieHeader(createSession('user-admin'));
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/dashboard']}>
        <AuthProvider>
          <PreferencesProvider>
            <Routes>
              <Route path="/dashboard" element={<DashboardPage />} />
            </Routes>
          </PreferencesProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Records every /leads request so we can assert how counts are derived. */
function recordLeadRequests() {
  const requests: { statusId: string | null; pageSize: string | null }[] = [];
  server.use(
    http.get('/api/v1/leads', ({ request }) => {
      const url = new URL(request.url);
      requests.push({
        statusId: url.searchParams.get('statusId'),
        pageSize: url.searchParams.get('pageSize'),
      });
      return HttpResponse.json({ total: 4, rows: [] });
    }),
  );
  return requests;
}

describe('dashboard', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  it('derives the scope total from the server count, not from fetched rows', async () => {
    server.use(
      // total deliberately far exceeds the rows returned.
      http.get('/api/v1/leads', () => HttpResponse.json({ total: 137, rows: [] })),
    );

    renderDashboard();

    expect(await screen.findByText('137')).toBeInTheDocument();
  });

  it('asks for one pageSize=1 count per status once a journey is selected', async () => {
    const requests = recordLeadRequests();
    renderDashboard();

    fireEvent.click(await screen.findByRole('tab', { name: JOURNEYS[0]!.name }));
    // 7 statuses in the seed template.
    await screen.findAllByText('4');

    const countRequests = requests.filter((entry) => entry.statusId !== null);
    expect(countRequests.length).toBeGreaterThan(0);
    // Counts must never pull rows back — that would be slow and a scope leak.
    expect(countRequests.every((entry) => entry.pageSize === '1')).toBe(true);

    // One count per distinct status, never more.
    const distinctStatuses = new Set(countRequests.map((entry) => entry.statusId));
    expect(countRequests).toHaveLength(distinctStatuses.size);

    // The scope total is its own request, not a sum of the per-status counts.
    expect(requests.some((entry) => entry.statusId === null && entry.pageSize === '1')).toBe(true);
  });

  it('groups statuses under their outcome headings', async () => {
    recordLeadRequests();
    renderDashboard();

    fireEvent.click(await screen.findByRole('tab', { name: JOURNEYS[0]!.name }));

    expect(await screen.findByRole('heading', { name: 'Open' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Won' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Lost' })).toBeInTheDocument();
  });

  it('shows no tasks card, because no tasks API exists', async () => {
    renderDashboard();
    await screen.findByText(/sellers in your view/i);

    expect(screen.queryByText(/task/i)).not.toBeInTheDocument();
  });

  it('labels the activity panel honestly', async () => {
    renderDashboard();

    expect(await screen.findByText('Recently updated')).toBeInTheDocument();
    expect(screen.getByText(/no activity-log api yet/i)).toBeInTheDocument();
  });

  it('explains itself when journey configuration is forbidden', async () => {
    server.use(
      http.get('/api/v1/journeys', () =>
        HttpResponse.json({ error: 'forbidden' }, { status: 403 }),
      ),
    );

    renderDashboard();

    expect(await screen.findByText(/isn't visible to your role/i)).toBeInTheDocument();
  });

  it('prompts for a journey before showing a breakdown', async () => {
    renderDashboard();

    expect(await screen.findByText(/pick a journey to see how its sellers/i)).toBeInTheDocument();
  });

  it('renders the distribution with real numbers beside the chart', async () => {
    recordLeadRequests();
    renderDashboard();

    fireEvent.click(await screen.findByRole('tab', { name: JOURNEYS[0]!.name }));

    // The SVG is decorative; the figures must be readable text.
    const openGroup = (await screen.findByRole('heading', { name: 'Open' })).closest('section')!;
    expect(within(openGroup).getAllByText('4').length).toBeGreaterThan(0);
  });
});
