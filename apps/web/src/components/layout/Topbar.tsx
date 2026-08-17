import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../app/AuthContext';
import { usePageChromeValue } from '../../app/page-chrome';
import { useSignOut } from '../../app/use-sign-out';
import { RingAvatar } from '../ui/RingAvatar';
import { NotificationBell } from '../notifications/NotificationBell';
import { Popover } from '../ui/Popover';
import { RefreshButton } from './RefreshButton';
import { GlobalSearch } from './GlobalSearch';
import { ButtonLink } from '../ui/Button';

interface TopbarProps {
  /** Fallback only — the active route supplies the real title via page chrome. */
  title: string;
  onOpenMenu: () => void;
}

/** The one plus in the app. An inline glyph, so it matches every other icon. */
function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

const iconButton =
  'inline-flex h-9 w-9 items-center justify-center rounded-control text-ink-soft hover:bg-surface-sunken hover:text-ink';

export function Topbar({ title, onOpenMenu }: TopbarProps) {
  const { user, can } = useAuth();
  const { title: routeTitle } = usePageChromeValue();
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const signOut = useSignOut();
  const searchToggleRef = useRef<HTMLButtonElement>(null);

  /*
   * The mobile search sheet is not a `Popover` — it drops below the whole
   * header rather than anchoring to its trigger — so it gets the same dismissal
   * contract explicitly instead of a different one by omission.
   */
  useEffect(() => {
    if (!mobileSearchOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMobileSearchOpen(false);
      searchToggleRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileSearchOpen]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await signOut();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <header className="relative flex min-h-16 flex-wrap items-center gap-3 border-b border-line bg-surface px-4 text-ink sm:px-6">
      <button
        type="button"
        onClick={onOpenMenu}
        className="rounded-control p-2 text-ink-soft hover:bg-surface-sunken hover:text-ink lg:hidden"
        aria-label="Open navigation menu"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 6h16M4 12h16M4 18h16"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <h1 className="shrink-0 font-display text-base font-semibold text-ink">
        {routeTitle || title}
      </h1>

      <div className="ml-4 hidden min-w-0 flex-1 lg:flex">
        <GlobalSearch />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          ref={searchToggleRef}
          type="button"
          onClick={() => setMobileSearchOpen((open) => !open)}
          aria-label="Search sellers"
          aria-expanded={mobileSearchOpen}
          className={`${iconButton} sm:hidden`}
        >
          <SearchIcon />
        </button>
        {can('leads', 'create') ? (
          <>
            <ButtonLink
              to="/sellers/new"
              size="sm"
              aria-label="Create a new seller"
              className="h-9 w-9 px-0 sm:hidden"
            >
              <PlusIcon />
            </ButtonLink>
            <ButtonLink to="/sellers/new" size="sm" className="hidden sm:inline-flex">
              <PlusIcon />
              New seller
            </ButtonLink>
          </>
        ) : null}
        <RefreshButton />
        <NotificationBell />
        <div className="hidden sm:block">
          <Popover
            label="Help and keyboard shortcuts"
            triggerClassName={`${iconButton} text-sm font-semibold`}
            panelClassName="w-64 p-4 text-sm text-ink"
            trigger={
              <>
                <span aria-hidden="true">?</span>
                <span className="sr-only">Help and keyboard shortcuts</span>
              </>
            }
          >
            <p className="font-semibold">Quick help</p>
            <p className="mt-1 text-ink-soft">
              Press <kbd className="rounded border border-line-strong px-1.5 py-0.5 text-xs">/</kbd>{' '}
              to search Sellers from anywhere.
            </p>
            <p className="mt-3 text-xs text-ink-soft">Search currently covers Sellers only.</p>
          </Popover>
        </div>
        {user ? (
          <Popover
            label="Account"
            align="right"
            triggerClassName="flex items-center gap-2 rounded-control px-2 py-1.5 hover:bg-surface-sunken"
            panelClassName="w-48 overflow-hidden py-1 text-ink"
            trigger={
              <>
                <RingAvatar name={user.name} size={32} tone="gold" />
                <span className="hidden text-left sm:block">
                  <span className="block text-sm font-medium leading-tight text-ink">
                    {user.name}
                  </span>
                  <span className="block text-xs leading-tight text-ink-soft">{user.roleName}</span>
                </span>
              </>
            }
          >
            <div className="border-b border-line px-3 py-2">
              <p className="truncate text-sm font-medium text-ink">{user.name}</p>
              <p className="truncate text-xs text-ink-soft">{user.email}</p>
            </div>
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              className="flex w-full items-center px-3 py-2 text-left text-sm text-ink hover:bg-paper disabled:opacity-60"
            >
              {loggingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </Popover>
        ) : null}
      </div>
      {mobileSearchOpen ? (
        <div className="w-full border-t border-line py-3 sm:hidden">
          <GlobalSearch mobile focusOnMount onNavigate={() => setMobileSearchOpen(false)} />
        </div>
      ) : null}
    </header>
  );
}
