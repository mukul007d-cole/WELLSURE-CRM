import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { configApi } from '../lib/api-client';
import { JOURNEYS } from '../mocks/fixtures';
import { createSession, setCookieHeader } from '../mocks/session';
import { server } from '../test/setup';
import { AuthProvider, useAuth } from './AuthContext';
import { useWorkableJourneySelect } from './workable-journeys';

function JourneyNames() {
  const { capabilities } = useAuth();
  const select = useWorkableJourneySelect();
  const journeys = useQuery({
    queryKey: ['journeys'],
    queryFn: configApi.journeys,
    select,
    enabled: capabilities !== null && capabilities !== undefined,
  });
  return (
    <p>{journeys.data ? journeys.data.map((journey) => journey.name).join('|') : 'loading'}</p>
  );
}

describe('useWorkableJourneySelect', () => {
  it('offers only the journeys the capability set names — role access and membership', async () => {
    const [allowed, ...others] = JOURNEYS;
    server.use(
      http.get('/api/v1/auth/capabilities', () =>
        HttpResponse.json({
          permissions: [{ module: 'leads', action: 'view', scope: 'SELF' }],
          journeyIds: [allowed!.id],
          fieldVisibility: [],
          hasAccessibleTools: false,
        }),
      ),
    );
    document.cookie = setCookieHeader(createSession('user-admin'));
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <AuthProvider>
            <JourneyNames />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(allowed!.name)).toBeInTheDocument();
    for (const other of others) expect(screen.queryByText(new RegExp(other.name))).toBeNull();
  });
});
