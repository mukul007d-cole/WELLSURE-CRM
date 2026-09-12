import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { AuthProvider } from '../../app/AuthContext';
import { PreferencesProvider } from '../../app/preferences';
import { FIELDS, JOURNEYS, LEADS } from '../../mocks/fixtures';
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
    localStorage.clear();
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
    localStorage.clear();
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

describe('seller list journey tabs', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  /**
   * The handler used to call `updateParam` twice — once for `journeyId`, once
   * to clear `statusId`. Each call builds its `next` params from the same
   * pre-click snapshot, so the second call didn't merge with the first, it
   * replaced it: the journey change was computed and then immediately
   * discarded. On screen that read as "the tab is clickable but has no
   * effect" — this is the direct regression test for that report.
   */
  it('actually switches to the journey that was clicked', async () => {
    const sentJourneyIds: Array<string | null> = [];
    server.use(
      http.get('/api/v1/leads', ({ request }) => {
        sentJourneyIds.push(new URL(request.url).searchParams.get('journeyId'));
        return HttpResponse.json({ total: 0, rows: [] });
      }),
    );
    renderPage();

    fireEvent.click(await screen.findByRole('tab', { name: JOURNEYS[0]!.name }));

    await waitFor(() => expect(sentJourneyIds.at(-1)).toBe(JOURNEYS[0]!.id));
    expect(screen.getByRole('tab', { name: JOURNEYS[0]!.name })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'All journeys' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });
});

describe('seller list sorting', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  it('sends the selected server sort and keeps it in the URL-backed view', async () => {
    const sorts: string[] = [];
    server.use(
      http.get('/api/v1/leads', ({ request }) => {
        const url = new URL(request.url);
        sorts.push(`${url.searchParams.get('sortBy')}:${url.searchParams.get('sortDirection')}`);
        return HttpResponse.json({ total: 0, rows: [] });
      }),
    );
    renderPage();

    fireEvent.change(await screen.findByLabelText('Sort sellers'), {
      target: { value: 'name:asc' },
    });

    await waitFor(() => expect(sorts.at(-1)).toBe('name:asc'));
    expect(screen.getByLabelText('Sort sellers')).toHaveValue('name:asc');
  });
});

describe('seller list columns', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  it('persists optional column visibility in this browser', async () => {
    renderPage();
    expect(await screen.findByRole('columnheader', { name: 'Owner' })).toBeInTheDocument();

    // The trigger carries the count, so the current state is readable without
    // opening the panel.
    fireEvent.click(screen.getByRole('button', { name: 'Columns (3)' }));
    fireEvent.click(screen.getByLabelText('Owner'));

    expect(screen.queryByRole('columnheader', { name: 'Owner' })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('falcon.ui.sellerColumns') ?? '[]')).not.toContain(
      'owner',
    );
    expect(screen.getByRole('button', { name: 'Columns (2)' })).toBeInTheDocument();
  });

  it('closes the column panel on Escape and outside clicks', async () => {
    renderPage();
    await screen.findByRole('columnheader', { name: 'Owner' });

    const trigger = screen.getByRole('button', { name: /^Columns/ });
    fireEvent.click(trigger);
    expect(screen.getByRole('group', { name: 'Column options' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Column options' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group', { name: 'Column options' })).not.toBeInTheDocument();
  });

  it('refuses to hide the last context column rather than ignoring the click', async () => {
    renderPage();
    await screen.findByRole('columnheader', { name: 'Owner' });
    fireEvent.click(screen.getByRole('button', { name: /^Columns/ }));

    // Scoped to the panel: "Journey" also names a filter-builder option.
    const panel = () => within(screen.getByRole('group', { name: 'Column options' }));
    fireEvent.click(panel().getByLabelText('Owner'));
    fireEvent.click(panel().getByLabelText('Status'));
    // One left: it is disabled, so the rule is visible rather than a dead click.
    expect(panel().getByLabelText('Journey')).toBeDisabled();
    expect(screen.getByRole('columnheader', { name: 'Journey' })).toBeInTheDocument();
  });
});

describe('seller list data-heavy columns', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  it('adds a column per Field once a specific journey is selected, and drops them for All journeys', async () => {
    const revenueField = FIELDS.find((field) => field.key === 'monthly_revenue')!;
    const journeyId = LEADS[0]!.processInstances[0]!.journeyId;
    // `sortBy=name` sidesteps the fixture's seeded-random `updatedAt` values —
    // this replicates the mock's own sort so the target lead is guaranteed to
    // land on page 1, deterministically.
    const [lead] = [...LEADS]
      .filter((candidate) => candidate.processInstances[0]?.journeyId === journeyId)
      .sort((a, b) => a.name.localeCompare(b.name));
    const expectedValue = (lead!.fieldValues['field-monthly-revenue'] as number).toLocaleString(
      'en-IN',
    );

    renderPage(`/sellers?journeyId=${journeyId}&sortBy=name&sortDirection=asc`);

    // Picking a journey is the "data heavy" view: every organization Field
    // gets a column, not just the fixed Journey/Status/Owner set.
    expect(
      await screen.findByRole('columnheader', { name: revenueField.label }),
    ).toBeInTheDocument();
    // Scoped to the desktop table specifically: the Field's own value (e.g.
    // Company Name) can otherwise collide with the seller's own name, and the
    // mobile card list — present in jsdom regardless of the `sm:hidden` class
    // that only hides it in a real browser — repeats it again.
    const table = screen.getByRole('table', { name: 'Sellers' });
    const dataRow = await waitFor(() => {
      const found = within(table)
        .getAllByRole('row')
        .find((candidate) => candidate.textContent?.includes(lead!.name));
      if (!found) throw new Error('row not rendered yet');
      return found;
    });
    expect(within(dataRow).getByText(expectedValue)).toBeInTheDocument();

    // "All journeys" stays the summary view — the Field columns disappear
    // rather than accumulate across every journey in the org.
    fireEvent.click(screen.getByRole('tab', { name: 'All journeys' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('columnheader', { name: revenueField.label }),
      ).not.toBeInTheDocument(),
    );
  });

  /**
   * The actual complaint: this used to show every organization Field as a
   * column once a journey was picked, whether or not that journey had ever
   * mapped it via the admin "Journey fields" screen — a column of nothing
   * but dashes, and a `requestedFieldIds` list padded with ids the journey
   * has no use for.
   */
  it('never shows a column for a Field the selected journey has not mapped', async () => {
    const revenueField = FIELDS.find((field) => field.key === 'monthly_revenue')!;
    const journeyId = LEADS[0]!.processInstances[0]!.journeyId;
    // Leaves `/api/v1/leads` on its default handler (real fixture rows) —
    // only what this journey maps changes.
    server.use(http.get(`/api/v1/journeys/${journeyId}/fields`, () => HttpResponse.json([])));

    renderPage(`/sellers?journeyId=${journeyId}`);

    await screen.findByRole('columnheader', { name: 'Owner' });
    expect(
      screen.queryByRole('columnheader', { name: revenueField.label }),
    ).not.toBeInTheDocument();
  });
});
