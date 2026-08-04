import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LeadShareDialog } from './LeadShareDialog';

describe('LeadShareDialog', () => {
  it('creates a view/edit/comment share and shows it in the active list', async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <LeadShareDialog
          leadId="lead-1"
          journeyId="journey-overlapping"
          assignmentTypes={['synthetic_owner']}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );
    await screen.findByRole('option', { name: 'Aman Verma' });
    fireEvent.change(screen.getByLabelText('User'), { target: { value: 'user-rep' } });
    fireEvent.click(screen.getByLabelText('Edit'));
    fireEvent.click(screen.getByLabelText('Add notes'));
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(screen.getByText(/View · Edit · Add notes/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Remove edit' }));
    await waitFor(() => expect(screen.getByText('View · Add notes')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Allow edit' })).not.toBeInTheDocument(),
    );
  });
});
