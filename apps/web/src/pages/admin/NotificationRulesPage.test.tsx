import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../app/AuthContext';
import { createSession, setCookieHeader } from '../../mocks/session';
import { NotificationRulesPage } from './NotificationRulesPage';

function renderPage() {
  const token = createSession('user-admin');
  document.cookie = setCookieHeader(token);
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {/* Row actions and the page frame render Links, so the page needs a router. */}
      <MemoryRouter>
        <AuthProvider>
          <NotificationRulesPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The request body every api-client call sends — always a JSON string. */
const sentBody = (call: readonly [unknown, (RequestInit | undefined)?] | undefined): unknown =>
  JSON.parse((call?.[1]?.body as string | undefined) ?? 'null');

/** The parameter controls are per recipient row, so index them positionally. */
const nth = (label: RegExp | string, index: number) => {
  const element = screen.getAllByLabelText(label)[index];
  if (!element) throw new Error(`No "${String(label)}" control at index ${index}`);
  return element;
};

describe('NotificationRulesPage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  it('creates a rule carrying several recipients in one request', async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input, init) => originalFetch(input, init));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Create rule' }));
    fireEvent.change(screen.getByLabelText(/^Key/), { target: { value: 'synthetic_notice' } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Synthetic notice' } });
    fireEvent.change(screen.getByLabelText(/^Trigger/), { target: { value: 'lead_reassigned' } });

    // First recipient: an assignment resolver, parameterized from the
    // assignment types the API reports as in use.
    await waitFor(() =>
      expect(
        within(nth(/^Assignment type/, 0)).getByRole('option', { name: 'owner' }),
      ).toBeInTheDocument(),
    );
    fireEvent.change(nth(/^Assignment type/, 0), { target: { value: 'owner' } });

    // Second recipient: a different resolver shape entirely.
    fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    fireEvent.change(nth(/^Resolver/, 1), { target: { value: 'feature_permission_holders' } });
    fireEvent.change(nth(/^Permission module/, 0), { target: { value: 'roles_permissions' } });
    fireEvent.change(nth(/^Permission action/, 0), { target: { value: 'view' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    await screen.findByText('Synthetic notice');

    const posted = fetchSpy.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(posted).toBeDefined();
    expect(sentBody(posted)).toEqual({
      key: 'synthetic_notice',
      name: 'Synthetic notice',
      triggerType: 'lead_reassigned',
      recipients: [
        { resolverType: 'assignment_holder', parameters: { assignmentType: 'owner' } },
        {
          resolverType: 'feature_permission_holders',
          parameters: { module: 'roles_permissions', action: 'view' },
        },
      ],
    });
    vi.restoreAllMocks();
  });

  it('renders triggers and resolvers as labels rather than raw codes', async () => {
    renderPage();
    const row = (await screen.findByText('Lead modified')).closest('tr');
    if (!row) throw new Error('Expected the seeded rule to render as a row');
    expect(within(row).getByText('Field edited')).toBeInTheDocument();
    expect(within(row).getByText('Assignment holder — owner')).toBeInTheDocument();
    expect(within(row).getByText('Holder’s manager — owner')).toBeInTheDocument();
    expect(within(row).queryByText(/assignment_holder/)).not.toBeInTheDocument();
    expect(within(row).queryByText(/field_edited/)).not.toBeInTheDocument();
  });

  it('loads an existing rule with its whole recipient list into the editor', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText(/^Key/)).toHaveValue('lead_modified_example');
    // The key identifies the rule for its lifetime and the API takes no key on
    // update, so the editor must not offer to change it.
    expect(screen.getByLabelText(/^Key/)).toBeDisabled();
    expect(screen.getByLabelText(/^Trigger/)).toHaveValue('field_edited');

    const resolvers = screen.getAllByLabelText(/^Resolver/);
    expect(resolvers).toHaveLength(2);
    expect(resolvers[0]).toHaveValue('assignment_holder');
    expect(resolvers[1]).toHaveValue('assignment_holder_manager');
    await waitFor(() => expect(nth(/^Assignment type/, 0)).toHaveValue('owner'));
    expect(nth(/^Assignment type/, 1)).toHaveValue('owner');
  });

  it('changes a recipient row’s parameter inputs with its resolver type', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Create rule' }));
    expect(screen.getAllByLabelText(/^Assignment type/)).toHaveLength(1);
    expect(screen.queryByLabelText(/^Permission module/)).not.toBeInTheDocument();

    fireEvent.change(nth(/^Resolver/, 0), { target: { value: 'feature_permission_holders' } });
    expect(screen.queryByLabelText(/^Assignment type/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Permission module/)).toBeInTheDocument();
    // The action list narrows to the chosen module's own actions.
    expect(screen.getByLabelText(/^Permission action/)).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Permission module/), {
      target: { value: 'lead_routing' },
    });
    const actions = within(screen.getByLabelText(/^Permission action/))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(actions).toEqual(['Select an action…', 'view', 'configure', 'operate']);

    // The parameterless resolvers render no parameter control at all.
    fireEvent.change(nth(/^Resolver/, 0), { target: { value: 'share_creator' } });
    expect(screen.queryByLabelText(/^Permission module/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Assignment type/)).not.toBeInTheDocument();
  });

  it('adds and removes recipient rows, never dropping below one', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Create rule' }));
    // A rule with no recipients is a validation error server-side.
    expect(screen.getByRole('button', { name: 'Remove recipient 1' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    expect(screen.getAllByLabelText(/^Resolver/)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Remove recipient 2' }));
    expect(screen.getAllByLabelText(/^Resolver/)).toHaveLength(1);
  });

  it('deactivates a rule through the update endpoint, keeping its recipients', async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input, init) => originalFetch(input, init));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByText('Inactive')).toBeInTheDocument();

    const put = fetchSpy.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(put).toBeDefined();
    expect(sentBody(put)).toEqual({
      name: 'Lead modified',
      triggerType: 'field_edited',
      active: false,
      recipients: [
        { resolverType: 'assignment_holder', parameters: { assignmentType: 'owner' } },
        { resolverType: 'assignment_holder_manager', parameters: { assignmentType: 'owner' } },
      ],
    });
    // Nothing is hard-deleted: the rule stays on the list, deactivated.
    expect(screen.getByText('Lead modified')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
