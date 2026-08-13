import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { AuthProvider } from '../../app/AuthContext';
import { PreferencesProvider } from '../../app/preferences';
import { FIELDS, JOURNEYS } from '../../mocks/fixtures';
import { createSession, setCookieHeader } from '../../mocks/session';
import { server } from '../../test/setup';
import { SellerListPage } from './SellerListPage';

/** Filter payloads the page actually sent, newest last. */
const sentFilters: Array<string | null> = [];

function captureListRequests() {
  server.use(
    http.get('/api/v1/leads', ({ request }) => {
      sentFilters.push(new URL(request.url).searchParams.get('filter'));
      return HttpResponse.json({ total: 0, rows: [] });
    }),
  );
}

function renderPage(path = '/sellers') {
  document.cookie = setCookieHeader(createSession('user-admin'));
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <PreferencesProvider>
          <AuthProvider>
            <Routes>
              <Route path="/sellers" element={<SellerListPage />} />
            </Routes>
          </AuthProvider>
        </PreferencesProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const lastFilter = () => sentFilters.at(-1);

describe('seller list filter builder', () => {
  beforeEach(() => {
    sentFilters.length = 0;
    sessionStorage.clear();
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  it('adds a condition and sends it with the list request', async () => {
    captureListRequests();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add condition' }));

    // A fresh condition defaults to a core column and has no value yet, so
    // nothing is sent until one is entered.
    fireEvent.change(screen.getByLabelText('Condition 1 value'), {
      target: { value: 'Synthetic' },
    });

    await waitFor(() =>
      expect(lastFilter()).toBe(
        JSON.stringify({
          conditions: [
            {
              target: { kind: 'core', column: 'name' },
              operator: 'contains',
              values: ['Synthetic'],
            },
          ],
        }),
      ),
    );
  });

  it('changes the operator list when the chosen field changes type', async () => {
    captureListRequests();
    const numberField = FIELDS.find((field) => field.type === 'number');
    expect(numberField, 'fixture needs a number Field').toBeDefined();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add condition' }));

    const operators = () =>
      [...screen.getByLabelText('Condition 1 operator').querySelectorAll('option')].map(
        (option) => option.value,
      );
    // Core `name` is text.
    expect(operators()).toEqual(['equals', 'contains', 'starts_with', 'is_empty', 'is_not_empty']);

    // The Field catalogue loads after the row renders; changing the select
    // before its option exists would be a no-op in jsdom.
    await screen.findByRole('option', { name: numberField!.label });
    fireEvent.change(screen.getByLabelText('Condition 1 field'), {
      target: { value: `field:${numberField!.id}` },
    });
    await waitFor(() =>
      expect(operators()).toEqual(['equals', 'greater_than', 'less_than', 'between', 'is_empty']),
    );
  });

  it('shows two value inputs for between and none for is empty', async () => {
    captureListRequests();
    const numberField = FIELDS.find((field) => field.type === 'number')!;
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add condition' }));
    await screen.findByRole('option', { name: numberField.label });
    fireEvent.change(screen.getByLabelText('Condition 1 field'), {
      target: { value: `field:${numberField.id}` },
    });
    fireEvent.change(await screen.findByLabelText('Condition 1 operator'), {
      target: { value: 'between' },
    });
    expect(await screen.findByLabelText('Condition 1 value 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Condition 1 value 2')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Condition 1 operator'), {
      target: { value: 'is_empty' },
    });
    await waitFor(() => expect(screen.queryByLabelText('Condition 1 value 1')).toBeNull());
  });

  it('removes a condition', async () => {
    captureListRequests();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add condition' }));
    fireEvent.change(screen.getByLabelText('Condition 1 value'), { target: { value: 'Alpha' } });
    await waitFor(() => expect(lastFilter()).toContain('Alpha'));

    fireEvent.click(screen.getByRole('button', { name: 'Remove condition 1' }));
    await waitFor(() => expect(lastFilter()).toBeNull());
  });

  it('restores a filter from the URL so a filtered list is shareable', async () => {
    captureListRequests();
    const filter = JSON.stringify({
      conditions: [
        { target: { kind: 'core', column: 'name' }, operator: 'contains', values: ['Bookmarked'] },
      ],
    });
    renderPage(`/sellers?filter=${encodeURIComponent(filter)}`);

    await waitFor(() => expect(lastFilter()).toBe(filter));
    // And the builder shows it rather than an empty row.
    expect(await screen.findByDisplayValue('Bookmarked')).toBeInTheDocument();
  });

  it('offers journey values by name for the journey column', async () => {
    captureListRequests();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add condition' }));
    fireEvent.change(await screen.findByLabelText('Condition 1 field'), {
      target: { value: 'core:journey' },
    });
    const value = await screen.findByLabelText('Condition 1 value');
    await waitFor(() =>
      expect([...value.querySelectorAll('option')].map((option) => option.textContent)).toContain(
        JOURNEYS[0]!.name,
      ),
    );
  });
});

describe('seller list export', () => {
  beforeEach(() => {
    sentFilters.length = 0;
    sessionStorage.clear();
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  it('sends the filters currently on screen, not a fresh unfiltered request', async () => {
    const exported: Array<string | null> = [];
    server.use(
      http.get('/api/v1/leads/export', ({ request }) => {
        const url = new URL(request.url);
        exported.push(url.searchParams.get('search'));
        return HttpResponse.text('lead_id,name\r\n', {
          headers: {
            'content-type': 'text/csv',
            'content-disposition': 'attachment; filename="sellers.csv"',
          },
        });
      }),
    );
    // jsdom has neither; the click path uses both to hand the file over.
    URL.createObjectURL = () => 'blob:mock';
    URL.revokeObjectURL = () => undefined;

    renderPage('/sellers?search=Vantage');
    fireEvent.click(await screen.findByRole('button', { name: /export csv/i }));
    await waitFor(() => expect(exported).toEqual(['Vantage']));
  });

  it('hides the button from a role without leads:export', async () => {
    document.cookie = setCookieHeader(createSession('user-rep'));
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/sellers']}>
          <PreferencesProvider>
            <AuthProvider>
              <Routes>
                <Route path="/sellers" element={<SellerListPage />} />
              </Routes>
            </AuthProvider>
          </PreferencesProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // The real enforcement is server-side; this only checks the affordance is
    // not offered to someone who would be refused.
    await screen.findByRole('heading', { name: /sellers/i });
    expect(screen.queryByRole('button', { name: /export csv/i })).not.toBeInTheDocument();
  });
});
