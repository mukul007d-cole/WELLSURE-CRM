import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Search from anywhere, the way every sales CRM opens.
 *
 * It deliberately does not invent a cross-entity search API: there is only a
 * seller search, so this routes into the seller list's existing `search`
 * param rather than implying it also finds users or journeys.
 */
interface GlobalSearchProps {
  focusOnMount?: boolean;
  mobile?: boolean;
  onNavigate?: () => void;
}

export function GlobalSearch({
  focusOnMount = false,
  mobile = false,
  onNavigate,
}: GlobalSearchProps) {
  const navigate = useNavigate();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState('');

  useEffect(() => {
    if (focusOnMount) inputRef.current?.focus();
  }, [focusOnMount]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // "/" is the near-universal focus-search key in this class of tool.
      const target = event.target as HTMLElement | null;
      const typingElsewhere =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true;
      if (event.key === '/' && !typingElsewhere) {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === 'Escape' && document.activeElement === inputRef.current) {
        inputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <form
      role="search"
      className={mobile ? 'block min-w-0 flex-1' : 'hidden min-w-0 flex-1 sm:block sm:max-w-sm'}
      onSubmit={(event) => {
        event.preventDefault();
        const query = term.trim();
        void navigate(query ? `/sellers?search=${encodeURIComponent(query)}` : '/sellers');
        onNavigate?.();
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        Search sellers
      </label>
      <div className="relative">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-soft"
        >
          <path
            d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        <input
          id={inputId}
          ref={inputRef}
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search sellers"
          className="h-9 w-full rounded-control border border-line-strong bg-surface pl-8 pr-9 text-sm text-ink placeholder:text-ink-soft focus-visible:border-gold"
        />
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-line-strong px-1.5 py-0.5 text-[10px] font-medium text-ink-soft md:block"
        >
          /
        </kbd>
      </div>
    </form>
  );
}
