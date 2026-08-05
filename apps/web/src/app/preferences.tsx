import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useLocalPreference } from '../lib/use-local-preference';

export type TableDensity = 'comfortable' | 'compact';

interface PreferencesValue {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (value: boolean) => void;
  tableDensity: TableDensity;
  setTableDensity: (value: TableDensity) => void;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isDensity = (value: unknown): value is TableDensity =>
  value === 'comfortable' || value === 'compact';

/**
 * Purely local view preferences. Nothing here is persisted server-side —
 * there's no user-preferences endpoint — so this is deliberately the only
 * home for them, shared by the shell and the Settings page.
 */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalPreference(
    'falcon.ui.sidebarCollapsed',
    false,
    isBoolean,
  );
  const [tableDensity, setTableDensity] = useLocalPreference<TableDensity>(
    'falcon.ui.tableDensity',
    'comfortable',
    isDensity,
  );

  const value = useMemo(
    () => ({ sidebarCollapsed, setSidebarCollapsed, tableDensity, setTableDensity }),
    [sidebarCollapsed, setSidebarCollapsed, tableDensity, setTableDensity],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error('usePreferences must be used within PreferencesProvider');
  return context;
}

/** Row padding for the desktop tables. Never changes which layout renders. */
export function densityRowClass(density: TableDensity): string {
  return density === 'compact' ? 'py-1.5' : 'py-3';
}
