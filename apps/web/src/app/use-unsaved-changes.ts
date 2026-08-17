import { useEffect } from 'react';

/** Protect long-running editors from an accidental tab close or full navigation. */
export function useUnsavedChanges(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}

/**
 * The same guard, for an editor held as a draft object.
 *
 * `draft !== null` is the tempting test and it is the wrong one: it fires the
 * moment an editor *opens*, so closing a tab after looking at a Field and
 * changing nothing gets a browser warning. A prompt that appears when there is
 * nothing to lose is worse than no prompt — it trains people to dismiss the one
 * that matters.
 *
 * `pristine` is the draft as it was loaded, so the comparison is against what
 * the server holds rather than against emptiness. Pages re-snapshot it when
 * data arrives asynchronously, because that is a load, not an edit.
 */
export function useUnsavedDraft<T>(draft: T | null, pristine: T | null): void {
  useUnsavedChanges(draft !== null && JSON.stringify(draft) !== JSON.stringify(pristine));
}
