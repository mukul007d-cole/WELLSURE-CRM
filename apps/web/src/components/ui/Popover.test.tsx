import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Popover } from './Popover';

function open() {
  fireEvent.click(screen.getByRole('button', { name: /options/i }));
}

function renderPopover() {
  return render(
    <div>
      <Popover label="Options" trigger="Options">
        <button type="button">Inside</button>
      </Popover>
      <button type="button">Outside</button>
    </div>,
  );
}

/**
 * The contract four hand-rolled panels were missing between them. Each case
 * here is a way a real user closes a menu and previously could not.
 */
describe('Popover', () => {
  it('opens and closes from its trigger, and reports state to assistive tech', () => {
    renderPopover();
    const trigger = screen.getByRole('button', { name: /options/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Inside' })).not.toBeInTheDocument();

    open();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Inside' })).toBeInTheDocument();

    open();
    expect(screen.queryByRole('button', { name: 'Inside' })).not.toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    renderPopover();
    open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Inside' })).not.toBeInTheDocument();
    // Without this a keyboard user is left with focus nowhere in particular.
    expect(screen.getByRole('button', { name: /options/i })).toHaveFocus();
  });

  it('closes on a pointer press outside itself', () => {
    renderPopover();
    open();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('button', { name: 'Inside' })).not.toBeInTheDocument();
  });

  it('stays open for a pointer press inside itself', () => {
    renderPopover();
    open();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Inside' }));
    expect(screen.getByRole('button', { name: 'Inside' })).toBeInTheDocument();
  });

  it('closes when focus moves out, so tabbing away agrees with clicking away', () => {
    renderPopover();
    open();
    fireEvent.focusIn(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('button', { name: 'Inside' })).not.toBeInTheDocument();
  });
});
