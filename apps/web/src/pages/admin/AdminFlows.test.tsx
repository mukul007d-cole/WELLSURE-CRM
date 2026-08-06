import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import { AuthProvider } from '../../app/AuthContext';
import { createSession, setCookieHeader } from '../../mocks/session';
import { server } from '../../test/setup';
import { DepartmentsPage } from './DepartmentsPage';
import { FieldsPage } from './FieldsPage';
import { JourneyDetailPage } from './JourneyDetailPage';
import { JourneysPage } from './JourneysPage';
import { RolesPage } from './RolesPage';
import { UsersPage } from './UsersPage';

function renderPage(element: React.ReactNode, path = '/admin', route = '/admin') {
  const token = createSession('user-admin');
  document.cookie = setCookieHeader(token);
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route path={route} element={element} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`, 'i')), { target: { value } });
}

describe('administration resource flows', () => {
  beforeEach(() => {
    sessionStorage.clear();
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  it('creates, edits, paginates, and deactivates Journeys', async () => {
    renderPage(<JourneysPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create Journey' }));
    change('Stable key', 'synthetic_journey');
    change('Name', 'Synthetic Journey');
    fireEvent.click(screen.getByRole('button', { name: 'Save Journey' }));
    expect(await screen.findByText('Synthetic Journey')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0] as HTMLElement);
    const names = screen.getAllByLabelText(/^Name/i);
    fireEvent.change(names[0] as HTMLElement, { target: { value: 'Renamed Journey' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Journey' }));
    expect(await screen.findByText('Renamed Journey')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate' })[0] as HTMLElement);
    await waitFor(() => expect(screen.queryByText('Renamed Journey')).not.toBeInTheDocument());
    expect(screen.getByText(/Page 1 of/)).toBeInTheDocument();
  });

  it('creates, edits, reorders, deactivates Statuses and attaches, edits, unmaps Journey Fields', async () => {
    let setting: Record<string, unknown> | null = null;
    server.use(
      http.get('/api/v1/journeys/:id/fields', () =>
        HttpResponse.json(
          setting ? [{ ...setting, field: { id: 'field-company', name: 'Company Name' } }] : [],
        ),
      ),
      http.put('/api/v1/journeys/:id/fields/:fieldId', async ({ params, request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        setting = {
          ...body,
          journeyId: params.id,
          fieldId: params.fieldId,
        };
        return HttpResponse.json(setting);
      }),
      http.delete('/api/v1/journeys/:id/fields/:fieldId', () => {
        const previous = setting;
        setting = null;
        return HttpResponse.json(previous);
      }),
    );
    renderPage(
      <JourneyDetailPage />,
      '/admin/journeys/journey-overlapping',
      '/admin/journeys/:journeyId',
    );
    await screen.findByRole('heading', { level: 2 });
    fireEvent.click(await screen.findByRole('button', { name: 'Create Status' }));
    change('Stable key', 'synthetic_status');
    change('Name', 'Synthetic Status');
    change('Order', '7');
    fireEvent.click(screen.getByRole('button', { name: 'Save Status' }));
    expect(await screen.findByText(/Synthetic Status/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0] as HTMLElement);
    const statusNames = screen.getAllByLabelText(/^Name/i);
    fireEvent.change(statusNames.at(-1) as HTMLElement, { target: { value: 'Edited Status' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Status' }));
    expect(await screen.findByText(/Edited Status/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /Move .* down/ })[0] as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Save Status order' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save Status order' })).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate' }).at(-1) as HTMLElement);
    change('Replacement Status', 'status-overlapping-new');
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Status' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Deactivate Status' })).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Attach Field' }));
    await screen.findByRole('option', { name: 'Company Name' });
    change('Field', 'field-company');
    change('Requirement', 'required');
    change('Required from Status', 'status-overlapping-contacted');
    const saveRule = screen.getByRole('button', { name: 'Save Field rule' });
    expect(saveRule).toBeEnabled();
    fireEvent.click(saveRule);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(await screen.findByText('Company Name')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit rule' }));
    change('Requirement', 'optional');
    fireEvent.click(screen.getByRole('button', { name: 'Save Field rule' }));
    await waitFor(() => expect(setting).toMatchObject({ requirement: 'optional' }));
    await screen.findByRole('button', { name: 'Unmap' });
    fireEvent.click(screen.getByRole('button', { name: 'Unmap' }));
    await waitFor(() => expect(screen.queryByText('Company Name')).not.toBeInTheDocument());
  });

  it('creates a select Field with options, edits it, and deactivates it', async () => {
    renderPage(<FieldsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create Field' }));
    change('Stable key', 'synthetic_select');
    change('Name', 'Synthetic Select');
    change('Type', 'select');
    change('Options', 'One\nTwo');
    change('Edit mode', 'manual');
    change('Source', 'manual');
    fireEvent.click(screen.getByRole('button', { name: 'Save Field' }));
    expect(await screen.findByText('Synthetic Select')).toBeInTheDocument();
    expect(screen.getByText('One, Two')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' }).at(-1) as HTMLElement);
    const names = screen.getAllByLabelText(/^Name/i);
    fireEvent.change(names.at(-1) as HTMLElement, { target: { value: 'Edited Select' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Field' }));
    expect(await screen.findByText('Edited Select')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate' }).at(-1) as HTMLElement);
  });

  it('filters, creates, edits, paginates, and deactivates Users without a password', async () => {
    let createBody: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/users', async ({ request }) => {
        createBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 'new-user', ...createBody, active: true }, { status: 201 });
      }),
    );
    renderPage(<UsersPage />);
    // The page heading now belongs to the User management shell this view is
    // nested in, so wait on a control the directory itself renders.
    await screen.findByLabelText('Search users');
    expect(await screen.findByText(/Page 1 of/)).toBeInTheDocument();
    change('Search users', 'Aman');
    change('Filter by role', 'role-admin');
    fireEvent.click(await screen.findByRole('button', { name: 'Create user' }));
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    change('Name', 'Synthetic User');
    change('Email', 'synthetic@example.test');
    change('Select a role search', 'Synthetic');
    await screen.findByRole('option', { name: 'Synthetic role A' });
    const editorRole = screen.getByLabelText(/^Role/i);
    fireEvent.change(editorRole, { target: { value: 'role-admin' } });
    expect(editorRole).toHaveValue('role-admin');
    const saveUser = screen.getByRole('button', { name: 'Save User' });
    expect(saveUser).toBeEnabled();
    fireEvent.click(saveUser);
    await waitFor(() => expect(createBody).toBeDefined());
    expect(createBody).not.toHaveProperty('password');
    change('Search users', '');
    change('Filter by role', '');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0] as HTMLElement);
    const names = screen.getAllByLabelText(/^Name/i);
    fireEvent.change(names.at(-1) as HTMLElement, { target: { value: 'Edited User' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save User' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate' })[0] as HTMLElement);
    await screen.findByRole('option', { name: 'Synthetic role B' });
  });

  it('creates and edits Departments and creates, edits, deactivates Roles with replacement selection', async () => {
    const { unmount } = renderPage(<DepartmentsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create Department' }));
    change('Stable key', 'synthetic_department');
    change('Name', 'Synthetic Department');
    fireEvent.click(screen.getByRole('button', { name: 'Save Department' }));
    expect(await screen.findByText('Synthetic Department')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' }).at(-1) as HTMLElement);
    const names = screen.getAllByLabelText(/^Name/i);
    fireEvent.change(names.at(-1) as HTMLElement, { target: { value: 'Edited Department' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Department' }));
    expect(await screen.findByText('Edited Department')).toBeInTheDocument();
    unmount();
    cleanup();
    renderPage(<RolesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create Role' }));
    change('Stable key', 'synthetic_role');
    change('Name', 'Synthetic Role');
    fireEvent.click(screen.getByRole('button', { name: 'Save Role' }));
    expect(await screen.findByText('Synthetic Role')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' }).at(-1) as HTMLElement);
    const roleNames = screen.getAllByLabelText(/^Name/i);
    fireEvent.change(roleNames.at(-1) as HTMLElement, { target: { value: 'Edited Role' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Role' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate' })[0] as HTMLElement);
    const replacement = screen.getByLabelText(/^Replacement role$/i);
    await within(replacement).findByRole('option', { name: 'Synthetic role B' });
    fireEvent.input(replacement, { target: { value: 'role-sales-rep' } });
    await waitFor(() => expect(replacement).toHaveValue('role-sales-rep'));
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Role' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: /Deactivate/ })).not.toBeInTheDocument(),
    );
  });

  it('renders loading, empty, API error, and stale-capability forbidden states', async () => {
    server.use(
      http.get('/api/v1/fields', async () => {
        await delay(100);
        return HttpResponse.json({ page: 1, pageSize: 25, total: 0, items: [] });
      }),
    );
    renderPage(<FieldsPage />);
    expect(screen.getByRole('heading', { name: 'Fields' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    expect(await screen.findByText('No records found')).toBeInTheDocument();
    server.use(
      http.get('/api/v1/fields', () => HttpResponse.json({ error: 'forbidden' }, { status: 403 })),
    );
    fireEvent.change(screen.getByLabelText('Active'), { target: { value: 'all' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/permission/i);
  });
});
