import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { Eyebrow } from '../../components/ui/Heading';
import { useAdminGroups } from './admin-sections';

function subNavLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'block whitespace-nowrap rounded-control px-3 py-2 text-sm transition-colors',
    isActive
      ? 'bg-surface-sunken font-medium text-ink'
      : 'text-ink-soft hover:bg-surface-sunken hover:text-ink',
  );
}

/**
 * The administration area (D12): one sidebar entry, and the grouping lives
 * here instead.
 *
 * A single nav serves every width. On a desktop it is a column beside the
 * page; on a phone the same groups lie in one horizontally scrolling strip,
 * so no area becomes unreachable and nothing is rendered twice for a test or
 * a screen reader to trip over.
 */
export function AdminLayout() {
  const groups = useAdminGroups();
  const location = useLocation();

  // Same outcome as `PermissionRoute` for someone with no admin area at all.
  if (!groups.length) {
    return <Navigate to="/sellers" replace state={{ forbiddenFrom: location.pathname }} />;
  }

  return (
    <div className="lg:flex lg:min-h-full">
      <nav
        aria-label="Admin"
        className="shrink-0 border-b border-line bg-surface lg:sticky lg:top-0 lg:max-h-dvh lg:w-60 lg:self-start lg:overflow-y-auto lg:border-b-0 lg:border-r"
      >
        <div className="flex items-center gap-4 overflow-x-auto px-4 py-2 lg:flex-col lg:items-stretch lg:gap-5 lg:overflow-visible lg:px-3 lg:py-5">
          <NavLink to="/admin" end className={subNavLinkClass}>
            Overview
          </NavLink>
          {groups.map((group) => {
            const headingId = `admin-nav-${group.label.toLowerCase().replace(/\W+/g, '-')}`;
            return (
              <div key={group.label} className="flex shrink-0 items-center gap-1 lg:block">
                <Eyebrow id={headingId} className="whitespace-nowrap pr-1 lg:px-3 lg:pb-1.5">
                  {group.label}
                </Eyebrow>
                <ul aria-labelledby={headingId} className="flex gap-1 lg:flex-col">
                  {group.sections.map((section) => (
                    <li key={section.to}>
                      <NavLink
                        to={section.to}
                        end={section.end ?? false}
                        className={subNavLinkClass}
                      >
                        {section.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </nav>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
