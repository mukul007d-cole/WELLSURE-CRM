import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePageChromeValue } from '../../app/page-chrome';
import { Spinner } from '../ui/Spinner';

export function RefreshButton() {
  const { refreshKeys } = usePageChromeValue();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const nothingToRefresh = refreshKeys.length === 0;

  async function refresh() {
    if (nothingToRefresh || refreshing) return;
    setRefreshing(true);
    try {
      // invalidateQueries resolves once the refetches it triggered settle, so
      // the spinner tracks real work. Only mounted queries refetch by default,
      // which is exactly "what this route is showing".
      await Promise.all(refreshKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void refresh()}
      disabled={nothingToRefresh || refreshing}
      aria-label="Refresh this page's data"
      aria-busy={refreshing}
      title={nothingToRefresh ? 'Nothing to refresh on this page' : "Refresh this page's data"}
      className="hidden h-9 w-9 items-center justify-center rounded-control text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent sm:inline-flex"
    >
      {refreshing ? (
        <Spinner size={16} tone="gold" label="Refreshing" />
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M20 11a8 8 0 1 0-.6 4M20 5v6h-6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
