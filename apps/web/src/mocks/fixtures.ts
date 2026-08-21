import type {
  BehaviorType,
  FieldDefinition,
  Journey,
  OutcomeType,
  Service,
  Status,
} from '../types/domain';

export const ORGANIZATION_ID = 'org-wellsure';

/*
 * Synthetic throughout, per AGENTS.md: journeys, statuses, services and fields
 * are admin configuration, so a fixture that names a real one invites code
 * that only works because the name is what it is.
 */
export const JOURNEYS: Journey[] = [
  { id: 'journey-alpha', key: 'journey_alpha', name: 'Journey Alpha', isActive: true },
  { id: 'journey-beta', key: 'journey_beta', name: 'Journey Beta', isActive: true },
  { id: 'journey-gamma', key: 'journey_gamma', name: 'Journey Gamma', isActive: true },
];

interface StatusSeed {
  key: string;
  name: string;
  outcomeType: OutcomeType;
  behaviorType: BehaviorType;
}

const STATUS_TEMPLATE: StatusSeed[] = [
  { key: 'new', name: 'New Lead', outcomeType: 'open', behaviorType: 'default' },
  { key: 'contacted', name: 'Contacted', outcomeType: 'open', behaviorType: 'default' },
  { key: 'follow_up', name: 'Follow Up', outcomeType: 'open', behaviorType: 'follow_up' },
  { key: 'call_later', name: 'Call Later', outcomeType: 'open', behaviorType: 'call_later' },
  { key: 'won', name: 'Won', outcomeType: 'closed_won', behaviorType: 'default' },
  { key: 'lost', name: 'Lost', outcomeType: 'closed_lost', behaviorType: 'default' },
  { key: 'archived', name: 'Archived', outcomeType: 'closed_lost', behaviorType: 'archived' },
];

export const STATUSES: Status[] = JOURNEYS.flatMap((journey) =>
  STATUS_TEMPLATE.map((template, index) => ({
    id: `status-${journey.key}-${template.key}`,
    journeyId: journey.id,
    key: template.key,
    name: template.name,
    outcomeType: template.outcomeType,
    behaviorType: template.behaviorType,
    isActive: true,
    sortOrder: index,
    // Creating a Lead with no explicit status falls back to this one.
    isDefaultOnCreate: index === 0,
  })),
);

export const SERVICES: Service[] = [
  { id: 'service-one', key: 'service_one', name: 'Service One', isActive: true },
  { id: 'service-two', key: 'service_two', name: 'Service Two', isActive: true },
  { id: 'service-three', key: 'service_three', name: 'Service Three', isActive: true },
  { id: 'service-four', key: 'service_four', name: 'Service Four', isActive: true },
];

export const FIELDS: FieldDefinition[] = [
  { id: 'field-company', key: 'company_name', label: 'Company Name', type: 'text' },
  {
    id: 'field-marketplace',
    key: 'marketplace',
    label: 'Marketplace',
    type: 'select',
    options: ['Amazon', 'Flipkart', 'Meesho', 'Myntra'],
  },
  { id: 'field-category', key: 'category', label: 'Category', type: 'text' },
  {
    id: 'field-monthly-revenue',
    key: 'monthly_revenue',
    label: 'Monthly Revenue (₹)',
    type: 'number',
  },
  { id: 'field-deal-value', key: 'deal_value', label: 'Deal Value (₹)', type: 'number' },
  { id: 'field-followup-date', key: 'followup_date', label: 'Follow-up Date', type: 'date' },
  { id: 'field-priority', key: 'is_priority', label: 'Priority Account', type: 'boolean' },
  { id: 'field-notes', key: 'notes', label: 'Notes', type: 'textarea' },
];

export interface MockUser {
  id: string;
  name: string;
  email: string;
  password: string;
  roleId: string;
  roleName: string;
  dataScope: 'SELF' | 'ORGANIZATION';
  /** Field ids this role cannot view/edit — the concrete permission-engine demo. */
  restrictedFieldIds: string[];
  permissions: Array<{ module: string; action: string; scope: 'SELF' | 'ORGANIZATION' }>;
}

export const USERS: MockUser[] = [
  {
    id: 'user-admin',
    name: 'Priya Shah',
    email: 'admin@wellsure.com',
    password: 'Wellsure@123',
    roleId: 'role-admin',
    roleName: 'Synthetic role A',
    dataScope: 'ORGANIZATION',
    restrictedFieldIds: [],
    permissions: [
      'journeys_statuses:view',
      'journeys_statuses:create',
      'journeys_statuses:edit',
      'journeys_statuses:delete',
      // Purge is withheld by bootstrap and granted deliberately (ADR-0017);
      // this mock admin is one who has been granted it.
      'journeys_statuses:purge',
      'fields:view',
      'fields:create',
      'fields:edit',
      'fields:delete',
      'fields:purge',
      'users:view',
      'users:create',
      'users:edit',
      'users:deactivate',
      'roles_permissions:view',
      'roles_permissions:create',
      'roles_permissions:edit',
      'campaigns:view',
      'campaigns:create',
      'campaigns:edit',
      'campaigns:send',
      'lead_routing:view',
      'lead_routing:configure',
      'lead_routing:operate',
      'leads:view',
      'leads:create',
      'leads:edit',
      'leads:export',
      'leads:import',
    ].map((value) => {
      const [module, action] = value.split(':') as [string, string];
      return { module, action, scope: 'ORGANIZATION' as const };
    }),
  },
  {
    id: 'user-rep',
    name: 'Aman Verma',
    email: 'rep@wellsure.com',
    password: 'Wellsure@123',
    roleId: 'role-sales-rep',
    roleName: 'Synthetic role B',
    dataScope: 'SELF',
    restrictedFieldIds: ['field-deal-value'],
    permissions: [{ module: 'leads', action: 'view', scope: 'SELF' }],
  },
];

const COMPANY_NAMES = [
  'Vantage Retail Co',
  'Nimbus Traders',
  'Sundial Exports',
  'Orchid Home Goods',
  'Bluecrest Apparel',
  'Meridian Foods',
  'Copper & Pine',
  'Zenith Electronics',
  'Willow Creek Beauty',
  'Trailmark Gear',
  'Harbor Kitchenware',
  'Larkspur Toys',
  'Granite Fitness',
  'Pinehollow Furniture',
  'Sable & Co Leather',
  'Riverbend Organics',
  'Amberlight Jewelry',
  'Cascade Sports',
  'Ironwood Tools',
  'Marigold Skincare',
  'Northstar Auto Parts',
  'Cobblestone Bakery',
  'Falcon Outdoor',
  'Terra Nova Home',
];

const MARKETPLACES = ['Amazon', 'Flipkart', 'Meesho', 'Myntra'] as const;
const CATEGORIES = [
  'Home & Kitchen',
  'Apparel',
  'Beauty',
  'Electronics',
  'Sports',
  'Toys',
  'Grocery',
];

function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    return value / 0x7fffffff;
  };
}

export interface MockLead {
  id: string;
  organizationId: string;
  name: string;
  phone: string;
  email: string;
  fieldValues: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  processInstances: Array<{
    processInstanceId: string;
    journeyId: string;
    statusId: string;
    active: boolean;
    assignments: Array<{ id: string; assignmentType: string; userId: string }>;
  }>;
}

const rand = seededRandom(42);

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)] as T;
}

export const LEADS: MockLead[] = COMPANY_NAMES.flatMap((company, index) => {
  const journey = pick(JOURNEYS);
  const journeyStatuses = STATUSES.filter((status) => status.journeyId === journey.id);
  const status = pick(journeyStatuses);
  const owner = pick(USERS);
  const createdDaysAgo = Math.floor(rand() * 120);
  const createdAt = new Date(Date.now() - createdDaysAgo * 86_400_000).toISOString();

  const lead: MockLead = {
    id: `lead-${index + 1}`,
    organizationId: ORGANIZATION_ID,
    name: company,
    phone: `+91 9${Math.floor(100000000 + rand() * 899999999)}`,
    email: `contact@${company.toLowerCase().replace(/[^a-z]+/g, '')}.com`,
    fieldValues: {
      company_name: company,
      marketplace: pick(MARKETPLACES),
      category: pick(CATEGORIES),
      monthly_revenue: Math.floor(50_000 + rand() * 4_500_000),
      deal_value: Math.floor(10_000 + rand() * 800_000),
      followup_date: new Date(Date.now() + Math.floor(rand() * 14) * 86_400_000)
        .toISOString()
        .slice(0, 10),
      is_priority: rand() > 0.8,
      notes: '',
    },
    createdAt,
    updatedAt: createdAt,
    processInstances: [
      {
        processInstanceId: `pi-${index + 1}`,
        journeyId: journey.id,
        statusId: status.id,
        active: status.outcomeType === 'open',
        assignments: [{ id: `assign-${index + 1}`, assignmentType: 'owner', userId: owner.id }],
      },
    ],
  };
  return [lead];
});

// Guarantee the demo rep has a handful of leads scoped to them, deterministically.
LEADS.slice(0, 6).forEach((lead) => {
  const assignment = lead.processInstances[0]?.assignments[0];
  if (assignment) {
    assignment.userId = 'user-rep';
  }
});

/**
 * Extra directory-only people, used by the org chart. All synthetic.
 *
 * Deliberately shaped to exercise the awkward cases: a three-level chain, a
 * second root, someone reporting to a manager who isn't in the set at all, and
 * a deactivated user. Reporting *loops* are injected per-test instead of living
 * here — a cycle in the shared fixture would make every other test's tree odd.
 */
export const DIRECTORY_USERS = [
  {
    id: 'dir-1',
    name: 'Alba Fenn',
    email: 'alba.fenn@example.test',
    roleId: 'role-admin',
    departmentId: 'department-synthetic',
    managerId: null as string | null,
    active: true,
  },
  {
    id: 'dir-2',
    name: 'Bo Ridley',
    email: 'bo.ridley@example.test',
    roleId: 'role-sales-rep',
    departmentId: 'department-synthetic',
    managerId: 'dir-1' as string | null,
    active: true,
  },
  {
    id: 'dir-3',
    name: 'Cass Oyelu',
    email: 'cass.oyelu@example.test',
    roleId: 'role-sales-rep',
    departmentId: 'department-b',
    managerId: 'dir-1' as string | null,
    active: true,
  },
  {
    id: 'dir-4',
    name: 'Dara Whitlow',
    email: 'dara.whitlow@example.test',
    roleId: 'role-sales-rep',
    departmentId: 'department-b',
    managerId: 'dir-2' as string | null,
    active: true,
  },
  {
    id: 'dir-5',
    name: 'Emeka Sandoval',
    email: 'emeka.sandoval@example.test',
    roleId: 'role-sales-rep',
    departmentId: 'department-b',
    managerId: 'dir-2' as string | null,
    active: false,
  },
  {
    id: 'dir-6',
    name: 'Fern Adeyemi',
    email: 'fern.adeyemi@example.test',
    roleId: 'role-admin',
    departmentId: 'department-c',
    managerId: null as string | null,
    active: true,
  },
  {
    id: 'dir-7',
    name: 'Gil Marchetti',
    email: 'gil.marchetti@example.test',
    roleId: 'role-sales-rep',
    departmentId: 'department-c',
    managerId: 'dir-6' as string | null,
    active: true,
  },
  // Manager sits outside the returned set — deactivated, or filtered by scope.
  {
    id: 'dir-8',
    name: 'Hana Brightwater',
    email: 'hana.brightwater@example.test',
    roleId: 'role-sales-rep',
    departmentId: 'department-c',
    managerId: 'dir-absent' as string | null,
    active: true,
  },
];
