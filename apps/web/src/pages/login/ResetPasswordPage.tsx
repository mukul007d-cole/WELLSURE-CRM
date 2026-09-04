import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, friendlyErrorMessage, passwordPolicyErrorMessage } from '../../lib/api-error';
import { authApi } from '../../lib/api-client';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(
    token ? null : 'This password link is invalid.',
  );
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirmation) {
      setError('The password confirmation does not match.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await authApi.completePasswordReset(token, password);
      setPassword('');
      setConfirmation('');
      setComplete(true);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'weak_password') {
        setError(passwordPolicyErrorMessage(cause));
      } else {
        setError(friendlyErrorMessage(cause));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-ink px-4 py-10 text-on-ink surface-ink">
      <div className="w-full max-w-sm rounded-card border border-on-ink-line bg-ink-raised p-6">
        <h1 className="font-display text-xl font-bold">Set your password</h1>
        {complete ? (
          <div className="mt-4 space-y-4">
            <Banner tone="success">Your password is set. Sign in to continue.</Banner>
            <Link className="inline-flex text-sm font-medium text-accent" to="/login">
              Go to sign in
            </Link>
          </div>
        ) : (
          <form className="mt-4 space-y-4" onSubmit={(event) => void submit(event)} noValidate>
            {error ? <Banner tone="error">{error}</Banner> : null}
            <Field label="New password" required tone="onInk">
              {({ inputId, describedBy }) => (
                <Input
                  id={inputId}
                  type="password"
                  autoComplete="new-password"
                  aria-describedby={describedBy}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              )}
            </Field>
            <Field label="Confirm new password" required tone="onInk">
              {({ inputId, describedBy }) => (
                <Input
                  id={inputId}
                  type="password"
                  autoComplete="new-password"
                  aria-describedby={describedBy}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              )}
            </Field>
            <Button type="submit" className="w-full" loading={submitting} disabled={!token}>
              Set password
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
