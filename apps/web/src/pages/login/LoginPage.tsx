import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../../app/AuthContext';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { friendlyErrorMessage } from '../../lib/api-error';

const schema = z.object({
  email: z.string().min(1, 'Enter your email address').email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  if (status === 'authenticated') {
    const redirectTo = (location.state as { from?: string } | null)?.from ?? '/sellers';
    return <Navigate to={redirectTo} replace />;
  }

  async function onSubmit(values: FormValues) {
    setFormError(null);
    try {
      await login(values.email, values.password);
      void navigate('/sellers', { replace: true });
    } catch (error) {
      setFormError(friendlyErrorMessage(error));
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink px-4 py-10 text-on-ink surface-ink">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <img src="/wellsure-logo.png" alt="Wellsure" className="h-24 w-auto" />
          <div>
            <h1 className="font-display text-xl font-bold tracking-wide text-on-ink">
              Welcome back
            </h1>
            <p className="mt-1 text-sm text-on-ink-soft">Sign in to your Wellsure CRM workspace</p>
          </div>
        </div>

        <form
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          noValidate
          className="rounded-card border border-on-ink-line bg-ink-raised p-6"
        >
          <div className="flex flex-col gap-4">
            {formError ? <Banner tone="error">{formError}</Banner> : null}

            <Field label="Email" error={errors.email?.message} required tone="onInk">
              {({ inputId, describedBy }) => (
                <Input
                  id={inputId}
                  type="email"
                  autoComplete="email"
                  invalid={Boolean(errors.email)}
                  aria-describedby={describedBy}
                  placeholder="you@wellsure.com"
                  {...register('email')}
                />
              )}
            </Field>

            <Field label="Password" error={errors.password?.message} required tone="onInk">
              {({ inputId, describedBy }) => (
                <Input
                  id={inputId}
                  type="password"
                  autoComplete="current-password"
                  invalid={Boolean(errors.password)}
                  aria-describedby={describedBy}
                  placeholder="••••••••"
                  {...register('password')}
                />
              )}
            </Field>

            <Button type="submit" loading={isSubmitting} className="mt-1 w-full">
              Sign in
            </Button>
          </div>
        </form>

        <details className="mt-5 rounded-control border border-on-ink-line bg-ink-raised/50 px-4 py-3 text-xs text-on-ink-soft">
          <summary className="cursor-pointer select-none font-medium text-on-ink">
            Demo accounts
          </summary>
          <div className="mt-2 flex flex-col gap-1.5">
            <p>
              <span className="text-on-ink">admin@wellsure.com</span> — Administrator, sees every
              seller and field
            </p>
            <p>
              <span className="text-on-ink">rep@wellsure.com</span> — Sales Rep, scoped to their own
              sellers with Deal Value hidden
            </p>
            <p>Password for both: Wellsure@123</p>
          </div>
        </details>
      </div>
    </div>
  );
}
