import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useLocalPreference } from '../lib/use-local-preference';

export type TableDensity = 'comfortable' | 'compact';
export type SellerColumn = 'journey' | 'status' | 'owner';

interface PreferencesValue {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (value: boolean) => void;
  tableDensity: TableDensity;
  setTableDensity: (value: TableDensity) => void;
  sellerColumns: SellerColumn[];
  setSellerColumns: (value: SellerColumn[]) => void;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isDensity = (value: unknown): value is TableDensity =>
  value === 'comfortable' || value === 'compact';
const sellerColumnSet = new Set<SellerColumn>(['journey', 'status', 'owner']);
const isSellerColumns = (value: unknown): value is SellerColumn[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (column) => typeof column === 'string' && sellerColumnSet.has(column as SellerColumn),
  );

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
  const [sellerColumns, setSellerColumns] = useLocalPreference<SellerColumn[]>(
    'falcon.ui.sellerColumns',
    ['journey', 'status', 'owner'],
    isSellerColumns,
  );

  const value = useMemo(
    () => ({
      sidebarCollapsed,
      setSidebarCollapsed,
      tableDensity,
      setTableDensity,
      sellerColumns,
      setSellerColumns,
    }),
    [
      sidebarCollapsed,
      setSidebarCollapsed,
      tableDensity,
      setTableDensity,
      sellerColumns,
      setSellerColumns,
    ],
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
