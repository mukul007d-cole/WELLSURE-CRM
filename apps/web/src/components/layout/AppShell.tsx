import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { PageChromeProvider } from '../../app/page-chrome';
import { usePreferences } from '../../app/preferences';

interface AppShellProps {
  title: string;
}

export function AppShell({ title }: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { sidebarCollapsed, setSidebarCollapsed } = usePreferences();

  return (
    <PageChromeProvider fallbackTitle={title}>
      <div className="flex h-dvh bg-paper">
        <div className="hidden lg:block">
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          />
        </div>

        {mobileNavOpen ? (
          <div className="fixed inset-0 z-40 flex lg:hidden">
            <button
              type="button"
              aria-label="Close navigation menu"
              className="absolute inset-0 bg-ink/50"
              onClick={() => setMobileNavOpen(false)}
            />
            <div className="relative z-10">
              {/*
                Always expanded, never the stored preference: the collapsed rail
                is a desktop space-saver, and a 4rem icon strip inside an overlay
                drawer would be worse on mobile, not better.
              */}
              <Sidebar collapsed={false} onNavigate={() => setMobileNavOpen(false)} />
            </div>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar title={title} onOpenMenu={() => setMobileNavOpen(true)} />
          <main className="flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </PageChromeProvider>
  );
}
