import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { ResetPasswordPage } from './ResetPasswordPage';

const renderPage = (entry = '/reset-password?token=synthetic-token') =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <ResetPasswordPage />
    </MemoryRouter>,
  );

function fill(password: string, confirmation = password) {
  fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: password } });
  fireEvent.change(screen.getByLabelText(/^Confirm new password/), {
    target: { value: confirmation },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Set password' }));
}

describe('reset password page', () => {
  it('rejects a confirmation mismatch without calling the API', async () => {
    let called = false;
    server.use(http.post('/api/v1/auth/password-reset/complete', () => void (called = true)));
    renderPage();
    fill('Synthetic-password-123!', 'Different-password-123!');
    expect(await screen.findByText(/confirmation does not match/i)).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it('surfaces the backend password-policy reasons', async () => {
    server.use(
      http.post('/api/v1/auth/password-reset/complete', () =>
        HttpResponse.json(
          { error: 'weak_password', details: { reasons: ['minimum_12_characters'] } },
          { status: 400 },
        ),
      ),
    );
    renderPage();
    fill('short');
    expect(await screen.findByText('Use at least 12 characters.')).toBeInTheDocument();
  });

  it.each([
    ['invalid_token', /invalid or has already been used/i],
    ['expired_token', /has expired/i],
  ])('shows the %s state', async (code, message) => {
    server.use(
      http.post('/api/v1/auth/password-reset/complete', () =>
        HttpResponse.json({ error: code }, { status: 400 }),
      ),
    );
    renderPage();
    fill('Synthetic-password-123!');
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('shows success and a sign-in path', async () => {
    server.use(
      http.post(
        '/api/v1/auth/password-reset/complete',
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    renderPage();
    fill('Synthetic-password-123!');
    expect(await screen.findByText(/password is set/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to sign in/i })).toHaveAttribute('href', '/login');
  });

  it('disables completion when the link has no token', () => {
    renderPage('/reset-password');
    expect(screen.getByText('This password link is invalid.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set password' })).toBeDisabled();
  });
});
