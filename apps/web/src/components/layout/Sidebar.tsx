import type { ReactElement } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { Eyebrow } from '../ui/Heading';
import { useAuth } from '../../app/AuthContext';
import { isAdminPath, useAdminGroups } from '../../pages/admin-hub/admin-sections';
import { useFollowUpSummary } from '../../pages/follow-ups/follow-up-queries';

interface NavItem {
  label: string;
  to?: string;
  icon: ReactElement;
  /** A count worth glancing at — rendered only when above zero. */
  badge?: number;
  /** Extra paths this entry owns beyond its own URL prefix. */
  owns?: (pathname: string) => boolean;
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

const TOOLS_ITEM: NavItem = {
  label: 'Tools',
  to: '/tools',
  icon: (
    <Icon d="M14.7 6.3a1 1 0 0 1 0 1.4l-6 6a1 1 0 0 1-1.4-1.4l6-6a1 1 0 0 1 1.4 0ZM7 15l-3 3 2 2 3-3M17 9l3-3-2-2-3 3" />
  ),
};

const FOLLOW_UPS_ITEM: NavItem = {
  label: 'Follow-ups',
  to: '/follow-ups',
  icon: <Icon d="M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />,
};

const ADMIN_ITEM: NavItem = {
  label: 'Admin',
  to: '/admin',
  icon: <Icon d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
};

/**
 * Genuinely unbuilt — no route, no API. Rendered non-interactive rather than
 * linked to a stub, so nobody demos a page that doesn't exist.
 */
const UPCOMING: NavItem[] = [{ label: 'Finance', icon: <Icon d="M4 7h16M4 12h16M4 17h10" /> }];

interface SidebarProps {
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

function navLinkClass(collapsed: boolean) {
  return ({ isActive }: { isActive: boolean }) =>
    cn(
      'relative flex items-center gap-3 rounded-control px-3 py-2.5 text-sm font-medium transition-colors',
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
    <Eyebrow tone="onInk" className={cn('px-3', first ? 'mt-0' : 'mt-6')}>
      {label}
    </Eyebrow>
  );
}

export function Sidebar({ onNavigate, collapsed = false, onToggleCollapse }: SidebarProps) {
  const { can, capabilities } = useAuth();
  const canAdministerTools =
    can('tools', 'create') || can('tools', 'edit') || can('tools', 'delete');
  const { pathname } = useLocation();
  const adminGroups = useAdminGroups();
  const followUps = useFollowUpSummary();
  const dueCount = followUps.data ? followUps.data.overdue + followUps.data.today : 0;
  const primaryItems: NavItem[] = [
    ...PRIMARY,
    // Every signed-in user has follow-ups of their own; the API decides which.
    { ...FOLLOW_UPS_ITEM, badge: dueCount },
    // Gated on the module permission *and* actually having something to see —
    // no existing nav entry needed this second check before, since none of
    // them hide behind a per-item allow-list the way Tools resources do. An
    // admin capability opens it too, independent of hasAccessibleTools: on a
    // library with zero resources granted to their own Role, that flag is
    // false for everyone including the admin who needs to create the first
    // one, and ToolsPage's own admin mode never required it either.
    ...(can('tools', 'view') && (capabilities?.hasAccessibleTools || canAdministerTools)
      ? [TOOLS_ITEM]
      : []),
  ];
  /**
   * One entry for every administration area (D12). Its own grouped navigation
   * lives inside the area; here it shows as soon as any one of those areas is
   * open to the user, and stays lit on the ones outside `/admin` (Import).
   */
  const adminItems: NavItem[] = adminGroups.length ? [{ ...ADMIN_ITEM, owns: isAdminPath }] : [];

  const renderLink = (item: NavItem) => {
    const badge = item.badge ? item.badge : null;
    // The count joins the name, so it is announced, not just seen.
    const name = badge ? `${item.label}, ${badge} due` : item.label;
    const owned = item.owns?.(pathname) ?? false;
    return (
      <li key={item.label}>
        <NavLink
          to={item.to ?? '#'}
          onClick={onNavigate}
          // The label leaves the page visually but stays in the accessibility
          // tree, so the collapsed rail is still navigable by name.
          aria-label={collapsed ? name : undefined}
          title={collapsed ? name : undefined}
          className={({ isActive }) => navLinkClass(collapsed)({ isActive: isActive || owned })}
        >
          {item.icon}
          <span className={collapsed ? 'sr-only' : undefined}>{item.label}</span>
          {badge && collapsed ? (
            <span
              aria-hidden="true"
              className="absolute right-2.5 top-1.5 h-2 w-2 rounded-full bg-gold"
            />
          ) : null}
          {badge && !collapsed ? (
            <>
              <span
                aria-hidden="true"
                className="ml-auto rounded-pill bg-gold px-1.5 py-0.5 text-xs font-semibold leading-none tabular-nums text-ink"
              >
                {badge}
              </span>
              <span className="sr-only">, {badge} due</span>
            </>
          ) : null}
        </NavLink>
      </li>
    );
  };

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
            <Eyebrow className="text-gold">CRM</Eyebrow>
          </div>
        )}
      </div>

      <nav id="sidebar-nav" className="flex-1 overflow-y-auto px-3 py-2" aria-label="Primary">
        <SectionHeading label="Workspace" collapsed={collapsed} first />
        <ul className="mt-2 flex flex-col gap-1">{primaryItems.map(renderLink)}</ul>

        {adminItems.length ? (
          <>
            <SectionHeading label="Administration" collapsed={collapsed} />
            <ul className="mt-2 flex flex-col gap-1">{adminItems.map(renderLink)}</ul>
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
