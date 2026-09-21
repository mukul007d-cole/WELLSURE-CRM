import { Component, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';

interface State {
  error: Error | null;
}

/**
 * Nothing else in this tree catches a render error, so without this an
 * uncaught exception anywhere in a routed page unmounts the whole app —
 * blank page, no nav, nothing short of a manual browser refresh recovers.
 * Caught here instead: the sidebar/topbar (this boundary sits inside
 * `AppShell`, around only the routed `<Outlet />`) stay usable, so "try
 * again" or navigating elsewhere both work without a refresh.
 */
class ErrorBoundaryImpl extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('Unhandled error rendering page', error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <EmptyState
          title="Something went wrong"
          description="This page hit an unexpected error. You can try again, or reload the page."
          action={
            <div className="flex justify-center gap-2">
              <Button variant="secondary" onClick={() => this.setState({ error: null })}>
                Try again
              </Button>
              <Button onClick={() => window.location.reload()}>Reload page</Button>
            </div>
          }
        />
      );
    }
    return this.props.children;
  }
}

/**
 * Keyed on the route so navigating away (sidebar, back button, a link inside
 * the fallback) always lands on a fresh boundary rather than staying stuck
 * showing the last page's error.
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <ErrorBoundaryImpl key={location.pathname}>{children}</ErrorBoundaryImpl>;
}
