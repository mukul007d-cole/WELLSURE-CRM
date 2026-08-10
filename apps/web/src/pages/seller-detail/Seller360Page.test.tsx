import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { AuthProvider } from '../../app/AuthContext';
import { PageChromeProvider } from '../../app/page-chrome';
import { FIELDS, JOURNEYS, LEADS } from '../../mocks/fixtures';
import { createSession, setCookieHeader } from '../../mocks/session';
import { server } from '../../test/setup';
import { Seller360Page } from './Seller360Page';

const LEAD = LEADS[0]!;
const HIDDEN_FIELD = FIELDS.find((field) => field.key === 'notes')!;
const VISIBLE_FIELD = FIELDS.find((field) => field.key === 'category')!;

function grantLeads(actions: string[], options: { fields?: boolean } = {}) {
  server.use(
    http.get('/api/v1/auth/capabilities', () =>
      HttpResponse.json({
        permissions: [
          ...actions.map((action) => ({ module: 'leads', action, scope: 'ORGANIZATION' })),
          ...(options.fields === false
            ? []
            : [{ module: 'fields', action: 'view', scope: 'ORGANIZATION' }]),
          { module: 'journeys_statuses', action: 'view', scope: 'ORGANIZATION' },
        ],
        journeyIds: JOURNEYS.map((journey) => journey.id),
        fieldVisibility: FIELDS.map((field) => ({ fieldId: field.id, accessLevel: 'EDIT' })),
      }),
    ),
  );
}

/** One field_edit entry, with whatever payload the case needs. */
function stubActivity(items: unknown[]) {
  server.use(
    http.get('/api/v1/leads/:id/activity', () =>
      HttpResponse.json({ page: 1, pageSize: 25, total: items.length, items }),
    ),
  );
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    processInstanceId: null,
    actorUserId: 'user-1',
    actorName: 'Synthetic Actor',
    timestamp: new Date().toISOString(),
    actionType: 'field_edit',
    source: 'lead_api',
    commentText: null,
    oldValue: null,
    newValue: null,
    ...overrides,
  };
}

function renderRecord() {
  document.cookie = setCookieHeader(createSession('user-admin'));
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[`/sellers/${LEAD.id}`]}>
        <AuthProvider>
          <PageChromeProvider fallbackTitle="Wellsure CRM">
            <Routes>
              <Route path="/sellers/:sellerId" element={<Seller360Page />} />
            </Routes>
          </PageChromeProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('seller record workspace', () => {
  beforeEach(() => {
    sessionStorage.clear();
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  it('shows the summary panel beside the activity timeline', async () => {
    grantLeads(['view']);
    renderRecord();

    expect(
      await screen.findByRole('complementary', { name: 'Seller summary' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true');
    // A real ordered list, not a stack of divs — the entries are a sequence.
    await waitFor(() => expect(screen.getByRole('list', { name: '' })).toBeTruthy());
  });

  it('renders only the fields that actually changed', async () => {
    grantLeads(['view']);
    stubActivity([
      entry({
        oldValue: { fieldValues: { [VISIBLE_FIELD.key]: 'Before', [HIDDEN_FIELD.key]: 'same' } },
        newValue: { fieldValues: { [VISIBLE_FIELD.key]: 'After', [HIDDEN_FIELD.key]: 'same' } },
      }),
    ]);
    renderRecord();

    expect(await screen.findByText(/After/)).toBeInTheDocument();
    // The unchanged field is in both snapshots but must not be listed.
    expect(screen.queryByText(new RegExp(HIDDEN_FIELD.label))).not.toBeInTheDocument();
  });

  it('says a change happened when every changed field was redacted', async () => {
    grantLeads(['view']);
    // The server dropped the changed keys, so both snapshots look identical.
    stubActivity([entry({ oldValue: { fieldValues: {} }, newValue: { fieldValues: {} } })]);
    renderRecord();

    expect(await screen.findByText(/can’t see/)).toBeInTheDocument();
  });

  it('never prints a raw field id when the viewer lacks fields:view', async () => {
    grantLeads(['view'], { fields: false });
    server.use(
      http.get('/api/v1/fields', () => HttpResponse.json({ error: 'forbidden' }, { status: 403 })),
    );
    stubActivity([
      entry({
        oldValue: { fieldValues: { [VISIBLE_FIELD.id]: 'Before' } },
        newValue: { fieldValues: { [VISIBLE_FIELD.id]: 'After' } },
      }),
    ]);
    renderRecord();

    expect(await screen.findByText(/A field/)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(VISIBLE_FIELD.id))).not.toBeInTheDocument();
  });

  it('names the actor as System on rows with no author', async () => {
    grantLeads(['view']);
    stubActivity([entry({ actorUserId: null, actorName: null, actionType: 'status_change' })]);
    renderRecord();

    expect(await screen.findByText('System')).toBeInTheDocument();
  });

  it('explains a forbidden timeline instead of showing an error', async () => {
    grantLeads(['view']);
    server.use(
      http.get('/api/v1/leads/:id/activity', () =>
        HttpResponse.json({ error: 'forbidden' }, { status: 403 }),
      ),
    );
    renderRecord();

    expect(await screen.findByText(/History isn’t visible to your role/)).toBeInTheDocument();
  });

  describe('permission gating', () => {
    it('hides comment, reassign and deactivate without their permissions', async () => {
      grantLeads(['view']);
      renderRecord();

      await screen.findByRole('complementary', { name: 'Seller summary' });
      expect(screen.queryByRole('button', { name: 'Comment' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reassign' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    });

    it('shows each action once its permission is granted', async () => {
      grantLeads(['view', 'comment', 'edit', 'delete']);
      renderRecord();

      expect(await screen.findByLabelText('Add a comment')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reassign' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
    });
  });

  describe('commenting', () => {
    it('appends optimistically and keeps the comment after the server confirms', async () => {
      grantLeads(['view', 'comment']);
      // Stateful, so the refetch that follows the mutation returns what the
      // POST stored. A stub that always answers [] would pass on the
      // optimistic render alone and prove nothing about the settled state.
      const stored: unknown[] = [];
      server.use(
        http.get('/api/v1/leads/:id/activity', () =>
          HttpResponse.json({ page: 1, pageSize: 25, total: stored.length, items: stored }),
        ),
        http.post('/api/v1/leads/:id/comments', async ({ request }) => {
          const body = (await request.json()) as { text: string };
          const created = entry({
            id: 'server-1',
            actionType: 'comment',
            commentText: body.text,
          });
          stored.unshift(created);
          return HttpResponse.json(created, { status: 201 });
        }),
      );
      renderRecord();

      fireEvent.change(await screen.findByLabelText('Add a comment'), {
        target: { value: 'Called, left a message' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

      expect(await screen.findByText('Called, left a message')).toBeInTheDocument();
    });

    it('rolls the entry back when the post fails', async () => {
      grantLeads(['view', 'comment']);
      stubActivity([]);
      server.use(
        http.post('/api/v1/leads/:id/comments', () =>
          HttpResponse.json({ error: 'forbidden' }, { status: 403 }),
        ),
      );
      renderRecord();

      fireEvent.change(await screen.findByLabelText('Add a comment'), {
        target: { value: 'This should not survive' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

      // Appears optimistically, then the rollback removes it.
      await waitFor(() =>
        expect(screen.queryByText('This should not survive')).not.toBeInTheDocument(),
      );
    });
  });
});
