import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { AuthProvider } from '../../app/AuthContext';
import { PreferencesProvider } from '../../app/preferences';
import { createSession, setCookieHeader } from '../../mocks/session';
import { server } from '../../test/setup';
import { SettingsPage } from './SettingsPage';

function renderSettings(userId = 'user-admin') {
  document.cookie = setCookieHeader(createSession(userId));
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/settings']}>
        <AuthProvider>
          <PreferencesProvider>
            <Routes>
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/login" element={<p>Login page</p>} />
            </Routes>
          </PreferencesProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('settings', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  it('shows the profile as read-only, since no self-update endpoint exists', async () => {
    renderSettings();

    const profile = (await screen.findByText('Your profile')).closest('div')!;
    expect(within(profile).queryByRole('textbox')).not.toBeInTheDocument();
    // Shown in both the profile and session cards.
    expect((await screen.findAllByText('admin@wellsure.com')).length).toBeGreaterThan(0);
  });

  it('persists the table density preference', async () => {
    renderSettings();

    fireEvent.change(await screen.findByLabelText('Table density'), {
      target: { value: 'compact' },
    });

    await waitFor(() => expect(localStorage.getItem('falcon.ui.tableDensity')).toBe('"compact"'));
  });

  it('persists the sidebar preference', async () => {
    renderSettings();

    fireEvent.click(await screen.findByLabelText(/start with the sidebar collapsed/i));

    await waitFor(() => expect(localStorage.getItem('falcon.ui.sidebarCollapsed')).toBe('true'));
  });

  it('signs out and returns to the login page', async () => {
    let loggedOut = false;
    server.use(
      http.post('/api/v1/auth/logout', () => {
        loggedOut = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(await screen.findByText('Login page')).toBeInTheDocument();
    expect(loggedOut).toBe(true);
  });

  it('changes the password and reports that other sessions ended', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/auth/password/change', async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderSettings();
    fireEvent.change(await screen.findByLabelText(/^Current password/), {
      target: { value: 'Current-password-123!' },
    });
    fireEvent.change(screen.getByLabelText(/^New password/), {
      target: { value: 'Changed-password-123!' },
    });
    fireEvent.change(screen.getByLabelText(/^Confirm new password/), {
      target: { value: 'Changed-password-123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/other signed-in sessions were ended/i)).toBeInTheDocument();
    expect(body).toEqual({
      currentPassword: 'Current-password-123!',
      newPassword: 'Changed-password-123!',
    });
  });

  it('does not submit mismatched password confirmation', async () => {
    let called = false;
    server.use(http.post('/api/v1/auth/password/change', () => void (called = true)));
    renderSettings();
    fireEvent.change(await screen.findByLabelText(/^New password/), {
      target: { value: 'Changed-password-123!' },
    });
    fireEvent.change(screen.getByLabelText(/^Confirm new password/), {
      target: { value: 'Different-password-123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/confirmation does not match/i)).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it('shows the reassignment-grace toggle for a user whose Role holds it, and saves changes', async () => {
    let body: unknown;
    server.use(
      http.patch('/api/v1/auth/preferences', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ retainViewAfterReassignment: true });
      }),
    );
    renderSettings();
    const toggle = await screen.findByLabelText(
      /keep view-only access for 30 days after a lead is reassigned/i,
    );
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(body).toEqual({ retainViewAfterReassignment: true });
  });

  it('hides the reassignment-grace toggle for a user whose Role lacks it', async () => {
    renderSettings('user-rep');
    await screen.findByText('Your profile');
    expect(
      screen.queryByText(/keep view-only access for 30 days after a lead is reassigned/i),
    ).not.toBeInTheDocument();
  });

  it('says plainly which settings have no backing', async () => {
    renderSettings();

    expect(await screen.findByText(/organisation and notification preferences/i)).toHaveTextContent(
      /aren.t available in this release/i,
    );
  });

  it('shows both guides to a user holding roles_permissions:view', async () => {
    renderSettings();

    expect(await screen.findByText('User Guide')).toBeInTheDocument();
    expect(await screen.findByText('Admin Guide')).toBeInTheDocument();
  });

  it('hides the Admin Guide from a role without roles_permissions:view', async () => {
    renderSettings('user-rep');

    expect(await screen.findByText('User Guide')).toBeInTheDocument();
    expect(screen.queryByText('Admin Guide')).not.toBeInTheDocument();
  });

  it('renders the User Guide as formatted Markdown when viewed', async () => {
    renderSettings();

    const guideRow = (await screen.findByText('User Guide')).closest('div')!.parentElement!;
    fireEvent.click(within(guideRow).getByRole('button', { name: 'View' }));

    // The mock content's `# User Guide` heading renders as an <h1>, not literal text.
    expect(
      await screen.findByRole('heading', { name: 'User Guide', level: 1 }),
    ).toBeInTheDocument();
  });

  it('downloads the guide as a .md file', async () => {
    // jsdom has neither; the download path uses both to hand the file over.
    URL.createObjectURL = () => 'blob:mock';
    URL.revokeObjectURL = () => undefined;
    const anchors: HTMLAnchorElement[] = [];
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === 'a') anchors.push(element as HTMLAnchorElement);
      return element;
    });
    renderSettings();

    const guideRow = (await screen.findByText('User Guide')).closest('div')!.parentElement!;
    try {
      fireEvent.click(within(guideRow).getByRole('button', { name: 'Download' }));
      await waitFor(() => expect(anchors.map((a) => a.download)).toEqual(['user-guide.md']));
    } finally {
      vi.restoreAllMocks();
    }
  });
});
