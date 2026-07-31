import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Field } from './Field';

/**
 * Regression coverage for the login-screen contrast bug: Field's label/hint
 * text used a hardcoded text-ink (near-black) color, which was illegible on
 * the dark ink-raised login card. The fix made label/hint/error color an
 * explicit `tone` prop instead of a fixed class.
 */
describe('Field tone', () => {
  it('defaults to ink-on-light text, not on-ink, for fields on a light surface', () => {
    render(
      <Field label="Email" required hint="We will never share this">
        {({ inputId }) => <input id={inputId} />}
      </Field>,
    );
    const label = screen.getByText('Email').closest('label');
    expect(label).toHaveClass('text-ink');
    expect(label).not.toHaveClass('text-on-ink');
    expect(screen.getByText('We will never share this')).toHaveClass('text-ink-soft');
  });

  it('switches to light-on-dark text when tone="onInk", fixing the illegible login labels', () => {
    render(
      <Field label="Email" required hint="We will never share this" tone="onInk">
        {({ inputId }) => <input id={inputId} />}
      </Field>,
    );
    const label = screen.getByText('Email').closest('label');
    expect(label).toHaveClass('text-on-ink');
    expect(label).not.toHaveClass('text-ink');
    expect(screen.getByText('We will never share this')).toHaveClass('text-on-ink-soft');
  });

  it('uses a brighter error red on ink surfaces so it stays readable against the dark card', () => {
    render(
      <Field label="Email" error="Enter a valid email" tone="onInk">
        {({ inputId }) => <input id={inputId} />}
      </Field>,
    );
    const error = screen.getByText('Enter a valid email');
    expect(error).toHaveClass('text-[#f0968d]');
    expect(error).not.toHaveClass('text-status-lost');
  });
});
