import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NotificationRulesPage } from './NotificationRulesPage';

describe('NotificationRulesPage', () => {
  it('creates an editable, parameterized rule', async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <NotificationRulesPage />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'synthetic_notice' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Synthetic notice' } });
    fireEvent.change(screen.getByLabelText('Resolver parameter'), {
      target: { value: 'synthetic_owner' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }));
    await waitFor(() => expect(screen.getByText('Synthetic notice')).toBeInTheDocument());
    expect(screen.getByText(/assignment_holder/)).toBeInTheDocument();
  });
});
