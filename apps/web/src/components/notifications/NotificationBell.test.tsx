import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { NotificationBell } from './NotificationBell';

function Location() {
  return <output>{useLocation().pathname}</output>;
}
describe('NotificationBell', () => {
  it('shows unread count, marks read, and navigates to the referenced seller', async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <NotificationBell />
          <Location />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByLabelText(/1 unread/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Notifications/));
    fireEvent.click(await screen.findByText('A synthetic seller was updated'));
    await waitFor(() => expect(screen.getByText('/sellers/lead-1')).toBeInTheDocument());
  });
});
