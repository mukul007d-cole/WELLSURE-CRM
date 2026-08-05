import { useState } from 'react';
import { useAuth } from '../../app/AuthContext';
import { usePageChromeValue } from '../../app/page-chrome';
import { useSignOut } from '../../app/use-sign-out';
import { RingAvatar } from '../ui/RingAvatar';
import { NotificationBell } from '../notifications/NotificationBell';
import { RefreshButton } from './RefreshButton';

interface TopbarProps {
  /** Fallback only — the active route supplies the real title via page chrome. */
  title: string;
  onOpenMenu: () => void;
}

export function Topbar({ title, onOpenMenu }: TopbarProps) {
  const { user } = useAuth();
  const { title: routeTitle } = usePageChromeValue();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const signOut = useSignOut();

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await signOut();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <header className="surface-ink flex h-16 items-center gap-3 border-b border-on-ink-line bg-ink px-4 text-on-ink sm:px-6">
      <button
        type="button"
        onClick={onOpenMenu}
        className="rounded-control p-2 text-on-ink hover:bg-ink-raised lg:hidden"
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

      <h1 className="font-display text-base font-semibold text-on-ink">{routeTitle || title}</h1>

      <div className="ml-auto flex items-center gap-2">
        <RefreshButton />
        <NotificationBell />
        {user ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex items-center gap-2 rounded-control px-2 py-1.5 hover:bg-ink-raised"
            >
              <RingAvatar name={user.name} size={32} tone="gold" />
              <span className="hidden text-left sm:block">
                <span className="block text-sm font-medium leading-tight text-on-ink">
                  {user.name}
                </span>
                <span className="block text-xs leading-tight text-on-ink-soft">
                  {user.roleName}
                </span>
              </span>
            </button>

            {menuOpen ? (
              <>
                <button
                  type="button"
                  aria-hidden="true"
                  tabIndex={-1}
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setMenuOpen(false)}
                />
                <div
                  role="menu"
                  className="absolute right-0 z-20 mt-2 w-48 overflow-hidden rounded-control border border-line bg-surface py-1 text-ink shadow-[var(--shadow-popover)]"
                >
                  <div className="border-b border-line px-3 py-2">
                    <p className="truncate text-sm font-medium text-ink">{user.name}</p>
                    <p className="truncate text-xs text-ink-soft">{user.email}</p>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void handleLogout()}
                    disabled={loggingOut}
                    className="flex w-full items-center px-3 py-2 text-left text-sm text-ink hover:bg-paper disabled:opacity-60"
                  >
                    {loggingOut ? 'Signing out…' : 'Sign out'}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
