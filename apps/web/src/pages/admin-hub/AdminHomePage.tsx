import { Link } from 'react-router-dom';
import { usePageChrome } from '../../app/page-chrome';
import { PageBody, PageHeader } from '../../components/layout/PageFrame';
import { Heading } from '../../components/ui/Heading';
import { useAdminGroups } from './admin-sections';

/** The landing page of the admin area: one card per area the user may open. */
export function AdminHomePage() {
  usePageChrome('Admin', []);
  const groups = useAdminGroups();

  return (
    <PageBody>
      <PageHeader
        title="Admin"
        description="Configure how the CRM works for everyone. You only see the areas your role can open."
      />
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label} className="space-y-3">
          <Heading level="subsection" as="h3">
            {group.label}
          </Heading>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.sections.map((section) => (
              <li key={section.to}>
                <Link
                  to={section.to}
                  className="block h-full rounded-card border border-line bg-surface p-(--space-panel) shadow-[var(--shadow-card)] transition-colors hover:border-line-strong hover:bg-surface-hover"
                >
                  <span className="block font-medium text-ink">{section.label}</span>
                  <span className="mt-1 block text-sm text-ink-soft">{section.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </PageBody>
  );
}
