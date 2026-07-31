import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusPill } from './StatusPill';

describe('StatusPill', () => {
  it('colors closed_won as won regardless of behavior type', () => {
    render(<StatusPill name="Deal Closed" outcomeType="closed_won" behaviorType="default" />);
    expect(screen.getByText('Deal Closed').closest('span')).toHaveClass('text-status-won');
  });

  it('colors an open follow_up status distinctly from the open default', () => {
    render(<StatusPill name="Needs a nudge" outcomeType="open" behaviorType="follow_up" />);
    expect(screen.getByText('Needs a nudge').closest('span')).toHaveClass('text-status-followup');
  });

  it('treats archived as its own muted tone even when the outcome is closed_lost', () => {
    render(<StatusPill name="Parked" outcomeType="closed_lost" behaviorType="archived" />);
    const pill = screen.getByText('Parked').closest('span');
    expect(pill).toHaveClass('text-status-archived');
    expect(pill).not.toHaveClass('text-status-lost');
  });

  it('always renders the admin-configured status name verbatim', () => {
    render(<StatusPill name="Whatever Admins Typed" outcomeType="open" behaviorType="default" />);
    expect(screen.getByText('Whatever Admins Typed')).toBeInTheDocument();
  });
});
