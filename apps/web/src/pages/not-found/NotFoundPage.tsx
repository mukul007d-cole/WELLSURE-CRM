import { usePageChrome } from '../../app/page-chrome';
import { ButtonLink } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageBody } from '../../components/layout/PageFrame';

/**
 * The catch-all inside `AppShell`'s routes (see `App.tsx`) — matched only
 * once every other authenticated route has already failed to match, so the
 * sidebar/topbar stay up and a mistyped or stale link (a bookmark to a
 * deleted admin page, a bad share link) is recoverable in place, not a dead
 * end.
 */
export function NotFoundPage() {
  usePageChrome('Not found', []);

  return (
    <PageBody>
      <div className="flex min-h-[60vh] items-center justify-center">
        <EmptyState
          icon={
            <span className="font-display text-2xl font-bold text-ink" aria-hidden="true">
              404
            </span>
          }
          title="Page not found"
          description="The page you're looking for doesn't exist, or may have moved."
          action={<ButtonLink to="/sellers">Back to Sellers</ButtonLink>}
        />
      </div>
    </PageBody>
  );
}
