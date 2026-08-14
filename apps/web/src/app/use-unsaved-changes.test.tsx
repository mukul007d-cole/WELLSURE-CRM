import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useUnsavedChanges } from './use-unsaved-changes';

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
