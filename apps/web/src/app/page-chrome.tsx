import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { QueryKey } from '@tanstack/react-query';

interface PageChrome {
  title: string;
  /**
   * The query keys this route actually shows. The Topbar refresh invalidates
   * exactly these, so refreshing the board doesn't refetch the admin tables
   * sitting cold in the cache.
   */
  refreshKeys: QueryKey[];
}

interface PageChromeValue {
  chrome: PageChrome;
  setChrome: (chrome: PageChrome) => void;
}

const PageChromeContext = createContext<PageChromeValue | null>(null);

export function PageChromeProvider({
  fallbackTitle,
  children,
}: {
  fallbackTitle: string;
  children: ReactNode;
}) {
  const [chrome, setChrome] = useState<PageChrome>({ title: fallbackTitle, refreshKeys: [] });
  const value = useMemo(() => ({ chrome, setChrome }), [chrome]);
  return <PageChromeContext.Provider value={value}>{children}</PageChromeContext.Provider>;
}

/**
 * A route declares its title and refreshable keys once.
 *
 * `refreshKeys` is serialized for the dependency list because callers build the
 * array inline; comparing by identity would re-run this effect every render.
 */
export function usePageChrome(title: string, refreshKeys: QueryKey[]): void {
  const context = useContext(PageChromeContext);
  const setChrome = context?.setChrome;
  const serialized = JSON.stringify(refreshKeys);

  useEffect(() => {
    if (!setChrome) return;
    setChrome({ title, refreshKeys: JSON.parse(serialized) as QueryKey[] });
    return () => setChrome({ title, refreshKeys: [] });
  }, [setChrome, title, serialized]);
}

export function usePageChromeValue(): PageChrome {
  const context = useContext(PageChromeContext);
  return context?.chrome ?? { title: '', refreshKeys: [] };
}
