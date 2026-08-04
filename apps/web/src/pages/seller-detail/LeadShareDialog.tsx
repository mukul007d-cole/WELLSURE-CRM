import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { adminApi, sellersApi } from '../../lib/api-client';
import type { ShareCapability } from '../../types/domain';
import { Button } from '../../components/ui/Button';

export function LeadShareDialog({
  leadId,
  journeyId,
  assignmentTypes,
  onClose,
}: {
  leadId: string;
  journeyId: string;
  assignmentTypes: string[];
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [userId, setUserId] = useState('');
  const [caps, setCaps] = useState<ShareCapability[]>(['view']);
  const shares = useQuery({
    queryKey: ['lead-shares', leadId],
    queryFn: () => sellersApi.shares(leadId, { journeyId, assignmentTypes }),
  });
  const users = useQuery({
    queryKey: ['share-users'],
    queryFn: () => adminApi.users({ active: true, pageSize: 100 }),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['lead-shares', leadId] });
  const create = useMutation({
    mutationFn: () =>
      sellersApi.share(leadId, { journeyId, assignmentTypes, userId, capabilities: caps }),
    onSuccess: refresh,
  });
  const toggle = (cap: ShareCapability) =>
    setCaps((current) =>
      cap === 'view'
        ? current
        : current.includes(cap)
          ? current.filter((x) => x !== cap)
          : [...current, cap],
    );
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
    >
      <div className="w-full max-w-xl rounded-control bg-surface p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 id="share-title" className="font-display text-xl font-bold">
            Share seller
          </h2>
          <button aria-label="Close share panel" onClick={onClose}>
            ×
          </button>
        </div>
        <label className="mt-4 block text-sm font-medium">
          User
          <select
            className="mt-1 w-full rounded-control border border-line p-2"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="">Select a user</option>
            {users.data?.items.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="mt-4 flex gap-4">
          <legend className="text-sm font-medium">Capabilities</legend>
          {(
            [
              ['view', 'View'],
              ['edit', 'Edit'],
              ['comment', 'Add notes'],
            ] as const
          ).map(([cap, label]) => (
            <label key={cap} className="text-sm">
              <input
                type="checkbox"
                checked={caps.includes(cap)}
                disabled={cap === 'view'}
                onChange={() => toggle(cap)}
              />{' '}
              {label}
            </label>
          ))}
        </fieldset>
        <Button
          className="mt-4"
          disabled={!userId || create.isPending}
          onClick={() => create.mutate()}
        >
          Share
        </Button>
        <h3 className="mt-6 text-sm font-semibold">Current shares</h3>
        <ul className="mt-2 divide-y divide-line">
          {shares.data?.map((share) => (
            <li key={share.id} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium">{share.userName}</p>
                <p className="text-xs text-ink-soft">
                  {share.capabilities
                    .map((c) => (c === 'comment' ? 'Add notes' : c[0]!.toUpperCase() + c.slice(1)))
                    .join(' · ')}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() =>
                    void sellersApi
                      .updateShare(leadId, share.id, {
                        journeyId,
                        assignmentTypes,
                        capabilities: share.capabilities.includes('edit')
                          ? share.capabilities.filter((cap) => cap !== 'edit')
                          : [...share.capabilities, 'edit'],
                      })
                      .then(refresh)
                  }
                >
                  {share.capabilities.includes('edit') ? 'Remove edit' : 'Allow edit'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void sellersApi.revokeShare(leadId, share.id, journeyId).then(refresh)
                  }
                >
                  Revoke
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
