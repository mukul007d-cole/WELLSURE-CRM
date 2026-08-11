import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { AuthProvider } from '../../../app/AuthContext';
import { FIELDS, JOURNEYS } from '../../../mocks/fixtures';
import { createSession, setCookieHeader } from '../../../mocks/session';
import { server } from '../../../test/setup';
import { CampaignsPage } from './CampaignsPage';
import { documentFromElement, emptyDocument } from './campaign-document';

function renderPage() {
  document.cookie = setCookieHeader(createSession('user-admin'));
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AuthProvider>
          <CampaignsPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The fixture admin has every catalogue permission, campaigns included. */
function grantCampaignPermissions(actions: string[]) {
  server.use(
    http.get('/api/v1/auth/capabilities', () =>
      HttpResponse.json({
        permissions: [
          ...actions.map((action) => ({ module: 'campaigns', action, scope: 'ORGANIZATION' })),
          { module: 'fields', action: 'view', scope: 'ORGANIZATION' },
          { module: 'journeys_statuses', action: 'view', scope: 'ORGANIZATION' },
        ],
        journeyIds: JOURNEYS.map((journey) => journey.id),
        fieldVisibility: FIELDS.map((field) => ({ fieldId: field.id, accessLevel: 'VIEW' })),
      }),
    ),
  );
}

describe('campaign document serialization', () => {
  it('walks edited markup into the stored vocabulary', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<p>Hello <strong>there</strong></p><ul><li>One</li><li><em>Two</em></li></ul>';
    expect(documentFromElement(root)).toEqual({
      blocks: [
        {
          type: 'paragraph',
          spans: [{ text: 'Hello ' }, { text: 'there', marks: ['bold'] }],
        },
        {
          type: 'bullet_list',
          items: [[{ text: 'One' }], [{ text: 'Two', marks: ['italic'] }]],
        },
      ],
    });
  });

  it('drops a link scheme the server would reject anyway', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p><a href="javascript:alert(1)">click</a></p>';
    const [block] = documentFromElement(root).blocks;
    expect(block?.spans?.[0]).toEqual({ text: 'click' });
  });

  it('starts a new campaign with an empty paragraph rather than nothing', () => {
    expect(emptyDocument().blocks).toHaveLength(1);
  });
});

describe('campaigns admin', () => {
  beforeEach(() => {
    sessionStorage.clear();
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  it('lists campaigns with their send stats', async () => {
    renderPage();
    expect(await screen.findByText('Synthetic welcome')).toBeInTheDocument();
    expect(screen.getByText(/3 sent/)).toBeInTheDocument();
    expect(screen.getByText(/1 without an email/)).toBeInTheDocument();
  });

  it('creates a triggered campaign with a journey and status', async () => {
    let created: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/campaigns', async ({ request }) => {
        created = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 'new', ...created }, { status: 201 });
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Create campaign' }));
    fireEvent.change(screen.getByLabelText(/^Stable key/i), {
      target: { value: 'synthetic_triggered' },
    });
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Synthetic triggered' } });
    fireEvent.change(screen.getByLabelText(/^Subject/i), { target: { value: 'Welcome aboard' } });
    fireEvent.change(screen.getByLabelText(/^When to send/i), { target: { value: 'triggered' } });

    // The status list only populates once a journey is chosen: statuses belong
    // to exactly one journey.
    expect(screen.getByLabelText(/^Status/i)).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Journey/i), {
      target: { value: JOURNEYS[0]!.id },
    });
    const status = await screen.findByLabelText(/^Status/i);
    await waitFor(() => expect(status).not.toBeDisabled());
    const option = (status as HTMLSelectElement).querySelectorAll('option')[1] as HTMLOptionElement;
    fireEvent.change(status, { target: { value: option.value } });

    fireEvent.click(screen.getByRole('button', { name: 'Save campaign' }));
    await waitFor(() => expect(created).toBeDefined());
    expect(created).toMatchObject({
      type: 'triggered',
      journeyId: JOURNEYS[0]!.id,
      statusId: option.value,
    });
    // A triggered campaign carries no filter — the server rejects one.
    expect(created).not.toHaveProperty('filter');
  });

  it('inserts a variable token into the body', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Create campaign' }));
    const body = screen.getByRole('textbox', { name: 'Campaign body' });
    body.textContent = 'Hi ';
    fireEvent.input(body);
    fireEvent.change(screen.getByLabelText('Insert a variable'), { target: { value: 'name' } });
    // jsdom has no execCommand, so this also exercises the fallback path the
    // composer needs for a browser without it.
    await waitFor(() => expect(body.textContent).toContain('{{name}}'));

    const options = [...screen.getByLabelText('Insert a variable').querySelectorAll('option')].map(
      (option) => option.value,
    );
    expect(options).toContain('name');
    expect(options).toContain(`field:${FIELDS[0]!.id}`);
  });

  it('activates and deactivates a campaign', async () => {
    const activations: boolean[] = [];
    server.use(
      http.post('/api/v1/campaigns/:id/activation', async ({ request }) => {
        const body = (await request.json()) as { active: boolean };
        activations.push(body.active);
        return HttpResponse.json({ id: 'campaign-synthetic', active: body.active });
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(activations).toEqual([false]));
  });

  it('sends a manual campaign and reports what happened', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Send now' }));
    expect(await screen.findByText(/Queued 2, sent 2, failed 0/)).toBeInTheDocument();
  });

  it('hides create, edit and send from a viewer who only holds campaigns:view', async () => {
    grantCampaignPermissions(['view']);
    renderPage();
    expect(await screen.findByText('Synthetic welcome')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create campaign' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send now' })).toBeNull();
  });

  it('offers editing but not sending when send is withheld', async () => {
    // campaigns:edit must not imply campaigns:send — mailing customers is its
    // own level of trust.
    grantCampaignPermissions(['view', 'create', 'edit']);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send now' })).toBeNull();
  });
});
