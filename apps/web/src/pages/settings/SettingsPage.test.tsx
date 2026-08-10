import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { AuthProvider } from '../../app/AuthContext';
import { PreferencesProvider } from '../../app/preferences';
import { createSession, setCookieHeader } from '../../mocks/session';
import { server } from '../../test/setup';
import { SettingsPage } from './SettingsPage';

function renderSettings() {
  document.cookie = setCookieHeader(createSession('user-admin'));
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

  it('says plainly which settings have no backing', async () => {
    renderSettings();

    expect(await screen.findByText(/organisation and notification preferences/i)).toHaveTextContent(
      /aren.t available in this release/i,
    );
  });
});
