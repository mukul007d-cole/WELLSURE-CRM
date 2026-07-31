import type { ReactElement } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '../../lib/cn';

interface NavItem {
  label: string;
  to?: string;
  icon: ReactElement;
}

function Icon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={d}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const PRIMARY: NavItem[] = [
  { label: 'Sellers', to: '/sellers', icon: <Icon d="M4 6h16M4 12h16M4 18h10" /> },
];

const UPCOMING: NavItem[] = [
  { label: 'Dashboard', icon: <Icon d="M4 13h6V4H4v9Zm10 7h6V4h-6v16ZM4 20h6v-4H4v4Z" /> },
  { label: 'Tasks', icon: <Icon d="m5 13 4 4L19 7" /> },
  { label: 'Finance', icon: <Icon d="M4 7h16M4 12h16M4 17h10" /> },
  {
    label: 'Settings',
    icon: (
      <Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3a8 8 0 0 1-.1 1.3l2 1.6-2 3.4-2.3-.9a8 8 0 0 1-2.2 1.3L15 22H9l-.4-2.3a8 8 0 0 1-2.2-1.3l-2.3.9-2-3.4 2-1.6A8 8 0 0 1 4 12a8 8 0 0 1 .1-1.3l-2-1.6 2-3.4 2.3.9c.66-.55 1.4-1 2.2-1.3L9 2h6l.4 2.3c.8.3 1.54.75 2.2 1.3l2.3-.9 2 3.4-2 1.6c.07.43.1.86.1 1.3Z" />
    ),
  },
];

interface SidebarProps {
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps) {
  return (
    <div className="surface-ink flex h-full w-64 flex-col bg-ink text-on-ink">
      <div className="flex items-center gap-2.5 px-5 py-6">
        <img
          src="/wellsure-logo.png"
          alt=""
          className="h-8 w-8 rounded-full object-cover"
          aria-hidden="true"
        />
        <div className="font-display leading-tight">
          <p className="text-sm font-bold tracking-wide text-on-ink">WELLSURE</p>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-gold">CRM</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2" aria-label="Primary">
        <ul className="flex flex-col gap-1">
          {PRIMARY.map((item) => (
            <li key={item.label}>
              <NavLink
                to={item.to ?? '#'}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-control px-3 py-2.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-ink-raised text-on-ink border-l-2 border-gold pl-[10px]'
                      : 'text-on-ink-soft hover:bg-ink-raised hover:text-on-ink',
                  )
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <p className="mt-6 px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-on-ink-soft">
          Coming soon
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {UPCOMING.map((item) => (
            <li key={item.label}>
              <span
                aria-disabled="true"
                className="flex cursor-not-allowed items-center gap-3 rounded-control px-3 py-2.5 text-sm font-medium text-on-ink-soft/50"
              >
                {item.icon}
                {item.label}
              </span>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-on-ink-line px-5 py-4">
        <p className="text-[11px] text-on-ink-soft">Let&rsquo;s succeed together.</p>
      </div>
    </div>
  );
}
