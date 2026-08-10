import { useCallback, useState } from 'react';

/**
 * A useState whose value survives reloads.
 *
 * Every localStorage access is guarded: Safari's private mode throws on write,
 * and a value written by an older build can be any shape at all, so the caller
 * supplies a type guard rather than us trusting whatever is on disk.
 */
export function useLocalPreference<T>(
  storageKey: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === null) return fallback;
      const parsed: unknown = JSON.parse(stored);
      return isValid(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  });

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // A preference that can't be persisted still applies for this session.
      }
    },
    [storageKey],
  );

  return [value, update];
}
