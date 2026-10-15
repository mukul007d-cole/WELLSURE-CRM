import { useMemo } from 'react';
import { useAuth } from '../../app/AuthContext';

export interface AdminSection {
  label: string;
  to: string;
  /** One sentence for the overview card. */
  description: string;
  /** The same grant the section's `PermissionRoute` checks in `App.tsx`. */
  permission: { module: string; action?: string };
  /** Exact-match highlighting, for a section whose URL prefixes a sibling's. */
  end?: boolean;
}

export interface AdminGroup {
  label: string;
  sections: AdminSection[];
}

/**
 * Every administration area, grouped by what the admin is doing (D12).
 *
 * One list feeds the sidebar's single Admin entry, the area's sub-navigation
 * and the overview cards, so the three cannot disagree about what exists or
 * who may see it. Hiding here is a courtesy only — each route is still
 * guarded, and the API refuses regardless.
 */
export const ADMIN_GROUPS: readonly AdminGroup[] = [
  {
    label: 'Pipeline',
    sections: [
      {
        label: 'Journeys & statuses',
        to: '/admin/journeys',
        description: 'Create pipelines and manage the ordered statuses a seller moves through.',
        permission: { module: 'journeys_statuses' },
      },
      {
        label: 'Fields',
        to: '/admin/fields',
        description: 'Define the information captured on a seller and who can see or edit it.',
        permission: { module: 'fields' },
      },
    ],
  },
  {
    label: 'People',
    sections: [
      {
        label: 'Users',
        to: '/admin/users',
        description: 'Invite people, assign their role and department, and deactivate leavers.',
        permission: { module: 'users' },
        // Org chart lives underneath this URL; only one of them is current.
        end: true,
      },
      {
        label: 'Org chart',
        to: '/admin/users/org-chart',
        description: 'See who reports to whom across the organisation.',
        permission: { module: 'users' },
      },
      {
        label: 'Departments & teams',
        to: '/admin/departments',
        description: 'Group people by function, and manage the teams inside each department.',
        permission: { module: 'users' },
      },
      {
        label: 'Roles & permissions',
        to: '/admin/roles',
        description: 'Decide what each role can see and do; names never confer access.',
        permission: { module: 'roles_permissions' },
      },
    ],
  },
  {
    label: 'Automation',
    sections: [
      {
        label: 'Notification rules',
        to: '/admin/notification-rules',
        description: 'Choose who gets an in-app notification when something happens to a lead.',
        permission: { module: 'roles_permissions' },
      },
      {
        label: 'Campaigns',
        to: '/admin/campaigns',
        description: 'Email your sellers — once, or automatically when they reach a status.',
        permission: { module: 'campaigns' },
      },
    ],
  },
  {
    label: 'Data',
    sections: [
      {
        label: 'Import leads',
        // Kept at its original URL: links and bookmarks predate the admin area.
        to: '/import',
        description: 'Bring leads in from a CSV; nothing is created until you confirm a preview.',
        permission: { module: 'leads', action: 'import' },
      },
    ],
  },
];

/** The groups the signed-in user may open, with empty groups dropped. */
export function useAdminGroups(): AdminGroup[] {
  const { can } = useAuth();
  return useMemo(
    () =>
      ADMIN_GROUPS.map((group) => ({
        ...group,
        sections: group.sections.filter((section) =>
          can(section.permission.module, section.permission.action ?? 'view'),
        ),
      })).filter((group) => group.sections.length > 0),
    [can],
  );
}

/** Whether a path belongs to the admin area — including sections outside `/admin`. */
export function isAdminPath(pathname: string): boolean {
  const within = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  return (
    within('/admin') ||
    ADMIN_GROUPS.some((group) => group.sections.some((section) => within(section.to)))
  );
}
