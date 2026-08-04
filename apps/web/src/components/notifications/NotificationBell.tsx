import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { notificationsApi } from '../../lib/api-client';

export function NotificationBell() {
  const [open, setOpen] = useState(false),
    navigate = useNavigate(),
    client = useQueryClient();
  const unread = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: notificationsApi.unread,
    refetchInterval: 30000,
  });
  const list = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list(),
    enabled: open,
  });
  const read = useMutation({
    mutationFn: notificationsApi.markRead,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  return (
    <div className="relative">
      <button
        aria-label={`Notifications${unread.data?.count ? ` (${unread.data.count} unread)` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((x) => !x)}
        className="relative rounded-control p-2 hover:bg-ink-raised"
      >
        🔔
        {unread.data?.count ? (
          <span className="absolute -right-1 -top-1 rounded-full bg-accent px-1 text-[10px] text-ink">
            {unread.data.count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-control border border-line bg-surface text-ink shadow-xl">
          <h2 className="border-b border-line p-3 font-semibold">Notifications</h2>
          {list.isPending ? (
            <p className="p-4 text-sm">Loading…</p>
          ) : list.data?.items.length ? (
            <ul className="max-h-96 overflow-auto">
              {list.data.items.map((item) => (
                <li key={item.id}>
                  <button
                    className={`w-full border-b border-line p-3 text-left text-sm ${item.read ? '' : 'bg-paper font-medium'}`}
                    onClick={() => {
                      read.mutate(item.id);
                      setOpen(false);
                      if (item.referenceLeadId) navigate(`/sellers/${item.referenceLeadId}`);
                    }}
                  >
                    <span className="block">{item.message}</span>
                    <time className="text-xs text-ink-soft">
                      {new Date(item.createdAt).toLocaleString()}
                    </time>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-ink-soft">No notifications yet.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
