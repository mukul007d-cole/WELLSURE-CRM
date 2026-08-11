import type { DataScope } from './types.js';

export const dataScopes = [
  'SELF',
  'TEAM',
  'DEPARTMENT',
  'ORGANIZATION',
] as const satisfies readonly DataScope[];

export const permissionCatalog = [
  {
    module: 'leads',
    label: 'Leads',
    actions: [
      'view',
      'create',
      'edit',
      'comment',
      'delete',
      'export',
      'bulk_reassign',
      'bulk_status_change',
    ],
  },
  { module: 'fields', label: 'Fields', actions: ['view', 'create', 'edit', 'delete'] },
  {
    module: 'journeys_statuses',
    label: 'Journeys & Statuses',
    actions: ['view', 'create', 'edit', 'delete'],
  },
  { module: 'services', label: 'Services', actions: ['view', 'create', 'edit'] },
  {
    module: 'users',
    label: 'Users & Departments',
    actions: ['view', 'create', 'edit', 'deactivate'],
  },
  {
    module: 'roles_permissions',
    label: 'Roles & Permissions',
    actions: ['view', 'create', 'edit'],
  },
  {
    module: 'reports',
    label: 'Reports',
    actions: ['view_standard', 'view_financial', 'build_custom'],
  },
  { module: 'attachments', label: 'Attachments', actions: ['upload', 'download', 'delete'] },
  {
    module: 'campaigns',
    label: 'Campaigns',
    // `send` is deliberately separate from `edit`: composing an email and
    // actually mailing customers are different levels of trust.
    actions: ['view', 'create', 'edit', 'send'],
  },
  { module: 'integrations', label: 'Integrations', actions: ['configure'] },
] as const;

export type PermissionModule = (typeof permissionCatalog)[number]['module'];
export type PermissionAction<M extends PermissionModule = PermissionModule> = Extract<
  (typeof permissionCatalog)[number],
  { module: M }
>['actions'][number];

const pairs = new Set<string>(
  permissionCatalog.flatMap(({ module, actions }) =>
    actions.map((action) => `${module}:${action}`),
  ),
);

export function isPermissionPair(module: string, action: string): boolean {
  return pairs.has(`${module}:${action}`);
}

export function isDataScope(scope: string): scope is DataScope {
  return (dataScopes as readonly string[]).includes(scope);
}
