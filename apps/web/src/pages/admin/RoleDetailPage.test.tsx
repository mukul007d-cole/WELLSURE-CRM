import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../app/AuthContext';
import { createSession, setCookieHeader } from '../../mocks/session';
import { RoleDetailPage } from './RoleDetailPage';

describe('Role full-replacement editor', () => {
  afterEach(() => vi.restoreAllMocks());
  it('keeps checkbox changes local and sends one complete set only on Save', async () => {
    const token = createSession('user-admin');
    document.cookie = setCookieHeader(token);
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input, init) => originalFetch(input, init));
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/admin/roles/role-admin']}>
          {/* Saving now re-reads the signed-in user's own grants, so the page
              needs the auth provider it gets in the real route tree. */}
          <AuthProvider>
            <Routes>
              <Route path="/admin/roles/:roleId" element={<RoleDetailPage />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const [checkbox] = await screen.findAllByRole('checkbox', { name: 'view' });
    if (!checkbox) throw new Error('Expected a view permission checkbox');
    fireEvent.click(checkbox);
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Save feature permissions' }));
    await vi.waitFor(() =>
      expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1),
    );
  });
});
