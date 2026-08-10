import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';
import { createSession, setCookieHeader } from '../mocks/session';
import { server } from '../test/setup';

/** Reads a capability and offers a button that re-reads the grant set. */
function CapabilityProbe() {
  const { status, can, refreshCapabilities } = useAuth();
  if (status === 'checking') return <p>checking</p>;
  return (
    <>
      <p data-testid="grant">{can('reports', 'view_standard') ? 'granted' : 'denied'}</p>
      <button type="button" onClick={() => void refreshCapabilities()}>
        Refresh grants
      </button>
    </>
  );
}

function renderProbe() {
  document.cookie = setCookieHeader(createSession('user-admin'));
  return render(
    <AuthProvider>
      <CapabilityProbe />
    </AuthProvider>,
  );
}

describe('auth capabilities', () => {
  beforeEach(() => {
    sessionStorage.clear();
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  it('picks up a grant added after sign-in without a reload', async () => {
    // The demo admin holds the whole catalogue, so start from an explicitly
    // empty set to make the transition observable.
    let permissions: Array<{ module: string; action: string; dataScope: string }> = [];
    server.use(
      http.get('/api/v1/auth/capabilities', () =>
        HttpResponse.json({ permissions, journeyIds: [], fieldVisibility: [] }),
      ),
    );

    const user = renderProbe();
    expect(await screen.findByTestId('grant')).toHaveTextContent('denied');

    // An admin edits their own role in another part of the app.
    permissions = [{ module: 'reports', action: 'view_standard', dataScope: 'ORGANIZATION' }];

    // Without the refresh handle this stays 'denied' until a full reload —
    // invalidateQueries had nothing to match, because capabilities are
    // provider state rather than a cached query.
    user.container.querySelector('button')?.click();

    await waitFor(() => expect(screen.getByTestId('grant')).toHaveTextContent('granted'));
  });

  it('keeps the session signed in when the refresh call fails', async () => {
    renderProbe();
    await screen.findByTestId('grant');

    server.use(
      http.get('/api/v1/auth/capabilities', () =>
        HttpResponse.json({ error: 'internal_error' }, { status: 500 }),
      ),
    );

    const button = screen.getByRole('button', { name: 'Refresh grants' });
    button.click();

    // A failed re-read is not a sign-out: the probe would unmount if status
    // fell back to 'checking' or the user were cleared.
    await waitFor(() => expect(screen.getByTestId('grant')).toBeInTheDocument());
  });
});
