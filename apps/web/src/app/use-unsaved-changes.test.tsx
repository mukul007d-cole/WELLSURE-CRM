import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useUnsavedChanges, useUnsavedDraft } from './use-unsaved-changes';

function Guard({ dirty }: { dirty: boolean }) {
  useUnsavedChanges(dirty);
  return null;
}

describe('useUnsavedChanges', () => {
  it('prevents browser exit only while an editor is dirty', () => {
    const view = render(<Guard dirty={false} />);
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true);
    view.rerender(<Guard dirty />);
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false);
    view.rerender(<Guard dirty={false} />);
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true);
  });
});

function DraftGuard({ draft, pristine }: { draft: unknown; pristine: unknown }) {
  useUnsavedDraft(draft, pristine);
  return null;
}

/** `beforeunload` returns false when a listener cancelled it. */
const blocked = () => !window.dispatchEvent(new Event('beforeunload', { cancelable: true }));

describe('useUnsavedDraft', () => {
  it('does not warn merely because an editor is open', () => {
    const draft = { name: 'A' };
    render(<DraftGuard draft={draft} pristine={{ name: 'A' }} />);
    // The bug this replaced: `draft !== null` warned here, so closing a tab
    // after looking at a record and changing nothing raised a prompt.
    expect(blocked()).toBe(false);
  });

  it('warns once the draft differs from what was loaded', () => {
    const view = render(<DraftGuard draft={{ name: 'A' }} pristine={{ name: 'A' }} />);
    view.rerender(<DraftGuard draft={{ name: 'B' }} pristine={{ name: 'A' }} />);
    expect(blocked()).toBe(true);
  });

  it('stops warning when the edit is reverted or the editor closes', () => {
    const view = render(<DraftGuard draft={{ name: 'B' }} pristine={{ name: 'A' }} />);
    expect(blocked()).toBe(true);
    view.rerender(<DraftGuard draft={{ name: 'A' }} pristine={{ name: 'A' }} />);
    expect(blocked()).toBe(false);
    view.rerender(<DraftGuard draft={{ name: 'B' }} pristine={{ name: 'A' }} />);
    expect(blocked()).toBe(true);
    view.rerender(<DraftGuard draft={null} pristine={null} />);
    expect(blocked()).toBe(false);
  });

  it('treats a late-arriving load as a load, not an edit', () => {
    // Field grants arrive after the editor opens; the baseline moves with them.
    const view = render(
      <DraftGuard draft={{ name: 'A', grants: [] }} pristine={{ name: 'A', grants: [] }} />,
    );
    const hydrated = { name: 'A', grants: ['role-1'] };
    view.rerender(<DraftGuard draft={hydrated} pristine={hydrated} />);
    expect(blocked()).toBe(false);
  });
});
