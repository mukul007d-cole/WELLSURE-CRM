import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider } from './AuthContext';
import { PermissionRoute } from './PermissionRoute';
import { ProtectedRoute } from './ProtectedRoute';
import { createSession, setCookieHeader } from '../mocks/session';

function renderGate(module: string, userId: string) {
  const token = createSession(userId); document.cookie = setCookieHeader(token);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/admin']}><AuthProvider><Routes><Route element={<ProtectedRoute />}><Route path="/sellers" element={<h1>Sellers fallback</h1>} /><Route element={<PermissionRoute module={module} />}><Route path="/admin" element={<h1>Allowed management</h1>} /></Route></Route></Routes></AuthProvider></MemoryRouter></QueryClientProvider>);
}

describe('permission-driven administration routes', () => {
  beforeEach(() => { sessionStorage.clear(); document.cookie = 'falcon_session=; Path=/; Max-Age=0'; });
  it.each(['roles_permissions', 'users'])('denies %s:view without the permission tuple', async (module) => {
    renderGate(module, 'user-rep');
    expect(await screen.findByRole('heading', { name: 'Sellers fallback' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Allowed management' })).not.toBeInTheDocument();
  });
  it.each(['roles_permissions', 'users'])('allows %s:view with the permission tuple', async (module) => {
    renderGate(module, 'user-admin');
    expect(await screen.findByRole('heading', { name: 'Allowed management' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Sellers fallback' })).not.toBeInTheDocument());
  });
});
