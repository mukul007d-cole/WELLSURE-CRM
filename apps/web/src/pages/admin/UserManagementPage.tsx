import { Outlet } from 'react-router-dom';
import { PageBody, PageHeader, SubNav } from '../../components/layout/PageFrame';

/**
 * The directory and the reporting tree are two views of the same thing —
 * people — so they live behind one nav entry with tabs rather than two
 * unrelated sidebar rows. Departments stays separate: it's an org structure
 * others reference, not a view of users.
 */
export function UserManagementPage() {
  return (
    <PageBody>
      <PageHeader
        title="User management"
        description="Everyone in the organisation, their roles, and who they report to."
      />
      <SubNav
        items={[
          { label: 'Directory', to: '/admin/users' },
          { label: 'Org chart', to: '/admin/users/org-chart' },
        ]}
      />
      <Outlet />
    </PageBody>
  );
}
