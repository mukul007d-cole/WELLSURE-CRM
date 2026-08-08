import type { ReactElement } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { useAuth } from '../../app/AuthContext';

interface NavItem {
  label: string;
  to?: string;
  icon: ReactElement;
}

function Icon({ d }: { d: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
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
  {
    label: 'Dashboard',
    to: '/dashboard',
    icon: <Icon d="M4 13h6V4H4v9Zm10 7h6V4h-6v16ZM4 20h6v-4H4v4Z" />,
  },
  // Sellers is one module; its table and board are views inside it, chosen
  // with the view switcher rather than two competing sidebar rows.
  { label: 'Sellers', to: '/sellers', icon: <Icon d="M4 6h16M4 12h16M4 18h10" /> },
];

const SETTINGS: NavItem = {
  label: 'Settings',
  to: '/settings',
  icon: (
    <Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3a8 8 0 0 1-.1 1.3l2 1.6-2 3.4-2.3-.9a8 8 0 0 1-2.2 1.3L15 22H9l-.4-2.3a8 8 0 0 1-2.2-1.3l-2.3.9-2-3.4 2-1.6A8 8 0 0 1 4 12a8 8 0 0 1 .1-1.3l-2-1.6 2-3.4 2.3.9c.66-.55 1.4-1 2.2-1.3L9 2h6l.4 2.3c.8.3 1.54.75 2.2 1.3l2.3-.9 2 3.4-2 1.6c.07.43.1.86.1 1.3Z" />
  ),
};

/**
 * Genuinely unbuilt — no route, no API. Rendered non-interactive rather than
 * linked to a stub, so nobody demos a page that doesn't exist.
 */
const UPCOMING: NavItem[] = [
  { label: 'Tasks', icon: <Icon d="m5 13 4 4L19 7" /> },
  { label: 'Finance', icon: <Icon d="M4 7h16M4 12h16M4 17h10" /> },
];

interface SidebarProps {
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

function navLinkClass(collapsed: boolean) {
  return ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center gap-3 rounded-control px-3 py-2.5 text-sm font-medium transition-colors',
      collapsed && 'justify-center gap-0 px-0',
      isActive
        ? cn('bg-ink-raised text-on-ink border-l-2 border-gold', collapsed ? '' : 'pl-[10px]')
        : 'text-on-ink-soft hover:bg-ink-raised hover:text-on-ink',
    );
}

function SectionHeading({
  label,
  collapsed,
  first,
}: {
  label: string;
  collapsed: boolean;
  first?: boolean;
}) {
  if (collapsed) {
    // Keep the grouping audible and visible without the words: a rule stands in
    // for the heading, and the label stays in the accessibility tree.
    return (
      <>
        {first ? null : <hr className="mx-2 mt-5 border-t border-on-ink-line" />}
        <p className="sr-only">{label}</p>
      </>
    );
  }
  return (
    <p
      className={cn(
        'px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-on-ink-soft',
        first ? 'mt-0' : 'mt-6',
      )}
    >
      {label}
    </p>
  );
}

export function Sidebar({ onNavigate, collapsed = false, onToggleCollapse }: SidebarProps) {
  const { can } = useAuth();
  /**
   * Grouped by what the user is doing, not by which table it writes to:
   * configuration shapes the pipeline, people & access decides who can act.
   * Each group still hides entirely when its permission is absent.
   */
  const configurationItems: NavItem[] = [
    ...(can('journeys_statuses', 'view')
      ? [{ label: 'Journeys', to: '/admin/journeys', icon: <Icon d="M4 6h16M4 12h12M4 18h8" /> }]
      : []),
    ...(can('fields', 'view')
      ? [{ label: 'Fields', to: '/admin/fields', icon: <Icon d="M5 5h14v14H5z" /> }]
      : []),
    ...(can('roles_permissions', 'view')
      ? [
          {
            label: 'Notification rules',
            to: '/admin/notification-rules',
            icon: <Icon d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />,
          },
        ]
      : []),
  ];

  const peopleItems: NavItem[] = [
    ...(can('users', 'view')
      ? [
          {
            label: 'User management',
            to: '/admin/users',
            icon: <Icon d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8" />,
          },
          {
            label: 'Departments',
            to: '/admin/departments',
            icon: <Icon d="M4 21V7l8-4 8 4v14M9 21v-5h6v5" />,
          },
        ]
      : []),
    ...(can('roles_permissions', 'view')
      ? [
          {
            label: 'Roles & permissions',
            to: '/admin/roles',
            icon: <Icon d="M12 2 4 6v6c0 5 3.4 8 8 10 4.6-2 8-5 8-10V6z" />,
          },
        ]
      : []),
  ];

  const renderLink = (item: NavItem) => (
    <li key={item.label}>
      <NavLink
        to={item.to ?? '#'}
        onClick={onNavigate}
        // The label leaves the page visually but stays in the accessibility
        // tree, so the collapsed rail is still navigable by name.
        aria-label={collapsed ? item.label : undefined}
        title={collapsed ? item.label : undefined}
        className={navLinkClass(collapsed)}
      >
        {item.icon}
        <span className={collapsed ? 'sr-only' : undefined}>{item.label}</span>
      </NavLink>
    </li>
  );

  return (
    <div
      className={cn(
        'surface-ink flex h-full flex-col bg-ink text-on-ink transition-[width] duration-200 motion-reduce:transition-none',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <div
        className={cn('flex items-center gap-2.5 py-6', collapsed ? 'justify-center px-2' : 'px-5')}
      >
        <img
          src="/wellsure-logo.png"
          alt=""
          className="h-8 w-8 shrink-0 rounded-full object-cover"
          aria-hidden="true"
        />
        {collapsed ? null : (
          <div className="font-display leading-tight">
            <p className="text-sm font-bold tracking-wide text-on-ink">WELLSURE</p>
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-gold">CRM</p>
          </div>
        )}
      </div>

      <nav id="sidebar-nav" className="flex-1 overflow-y-auto px-3 py-2" aria-label="Primary">
        <SectionHeading label="Workspace" collapsed={collapsed} first />
        <ul className="mt-2 flex flex-col gap-1">{PRIMARY.map(renderLink)}</ul>

        {configurationItems.length ? (
          <>
            <SectionHeading label="Configuration" collapsed={collapsed} />
            <ul className="mt-2 flex flex-col gap-1">{configurationItems.map(renderLink)}</ul>
          </>
        ) : null}

        {peopleItems.length ? (
          <>
            <SectionHeading label="People & access" collapsed={collapsed} />
            <ul className="mt-2 flex flex-col gap-1">{peopleItems.map(renderLink)}</ul>
          </>
        ) : null}

        <SectionHeading label="Coming soon" collapsed={collapsed} />
        <ul className="mt-2 flex flex-col gap-1">
          {UPCOMING.map((item) => (
            <li key={item.label}>
              <span
                aria-disabled="true"
                title={`${item.label} — not built in this release`}
                className={cn(
                  'flex cursor-not-allowed items-center gap-3 rounded-control px-3 py-2.5 text-sm font-medium text-on-ink-soft/50',
                  collapsed && 'justify-center gap-0 px-0',
                )}
              >
                {item.icon}
                <span className={collapsed ? 'sr-only' : undefined}>{item.label}</span>
              </span>
            </li>
          ))}
        </ul>

        <SectionHeading label="Account" collapsed={collapsed} />
        <ul className="mt-2 flex flex-col gap-1">{renderLink(SETTINGS)}</ul>
      </nav>

      {onToggleCollapse ? (
        <div className="hidden border-t border-on-ink-line px-3 py-2 lg:block">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-expanded={!collapsed}
            aria-controls="sidebar-nav"
            className={cn(
              'flex w-full items-center gap-3 rounded-control px-3 py-2 text-sm font-medium text-on-ink-soft transition-colors hover:bg-ink-raised hover:text-on-ink',
              collapsed && 'justify-center gap-0 px-0',
            )}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className={cn(
                'shrink-0 transition-transform duration-200 motion-reduce:transition-none',
                collapsed && 'rotate-180',
              )}
            >
              <path
                d="M15 6l-6 6 6 6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className={collapsed ? 'sr-only' : undefined}>
              {collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            </span>
          </button>
        </div>
      ) : null}

      {collapsed ? null : (
        <div className="border-t border-on-ink-line px-5 py-4">
          <p className="text-[11px] text-on-ink-soft">Let&rsquo;s succeed together.</p>
        </div>
      )}
    </div>
  );
}
