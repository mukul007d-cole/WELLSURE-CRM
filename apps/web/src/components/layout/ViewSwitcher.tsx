import { NavLink } from 'react-router-dom';
import { cn } from '../../lib/cn';

export interface ViewOption {
  label: string;
  to: string;
  icon: 'table' | 'board';
}

const ICONS: Record<ViewOption['icon'], string> = {
  table: 'M3 5h18M3 10h18M3 15h18M3 20h18',
  board: 'M4 5h5v14H4zM10 5h5v9h-5zM16 5h4v12h-4z',
};

/**
 * A segmented control for switching how one collection is displayed.
 *
 * Sellers as a table and sellers on a board are the same records, so they
 * belong to one module with a view toggle rather than two sidebar entries —
 * splitting them makes the board look like a separate feature and loses the
 * filters you already set.
 */
export function ViewSwitcher({ views }: { views: ViewOption[] }) {
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-control border border-line bg-surface-sunken p-0.5"
      role="group"
      aria-label="View"
    >
      {views.map((view) => (
        <NavLink
          key={view.to}
          to={view.to}
          end
          className={({ isActive }) =>
            cn(
              'inline-flex items-center gap-1.5 rounded-[4px] px-2.5 py-1.5 text-xs font-semibold transition-colors',
              isActive
                ? 'bg-surface text-ink shadow-[var(--shadow-card)]'
                : 'text-ink-soft hover:text-ink',
            )
          }
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d={ICONS[view.icon]}
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {view.label}
        </NavLink>
      ))}
    </div>
  );
}
