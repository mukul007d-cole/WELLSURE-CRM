/**
 * One place for every react-query key this app uses.
 *
 * Keys are built as strict prefix chains (`['board', journeyId, statusId]`) so
 * the Topbar refresh can invalidate a whole surface with `['board']` while a
 * mutation can target exactly one column — without either of them guessing at
 * key shapes written elsewhere.
 *
 * The pre-existing keys below keep their original shape verbatim; renaming
 * them would silently orphan cache entries the older pages still read.
 */
export const qk = {
  journeys: () => ['journeys'] as const,
  journeyStatuses: (journeyId: string) => ['statuses', journeyId] as const,
  fields: () => ['fields'] as const,
  seller: (leadId: string) => ['seller', leadId] as const,
  sellerActivity: (leadId: string) => ['seller', leadId, 'activity'] as const,
  sellerAttachments: (leadId: string) => ['seller', leadId, 'attachments'] as const,
  sellerRepeats: (leadId: string, needle: string) => ['seller', leadId, 'repeats', needle] as const,
  sellers: () => ['sellers'] as const,
  notifications: () => ['notifications'] as const,

  board: () => ['board'] as const,
  boardColumn: (journeyId: string, statusId: string) => ['board', journeyId, statusId] as const,

  dashboard: () => ['dashboard'] as const,
  dashboardTotal: (journeyId: string | undefined) =>
    ['dashboard', 'total', journeyId ?? null] as const,
  dashboardCount: (journeyId: string, statusId: string) =>
    ['dashboard', 'count', journeyId, statusId] as const,
  dashboardRecent: (journeyId: string | undefined) =>
    ['dashboard', 'recent', journeyId ?? null] as const,

  directory: () => ['directory'] as const,
  directoryUsers: () => ['directory', 'users'] as const,
  directoryRoles: () => ['directory', 'roles'] as const,
  directoryDepartments: () => ['directory', 'departments'] as const,

  importJobs: () => ['import', 'jobs'] as const,
};
