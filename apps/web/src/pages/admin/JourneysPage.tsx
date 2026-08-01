import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { adminApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import type { AdminJourney } from '../../types/domain';
import {
  ActiveFilter,
  AdminHeader,
  AdminTable,
  PageControls,
  activeValue,
  ADMIN_PAGE_SIZE,
} from './shared';

export function JourneysPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [active, setActive] = useState('true');
  const [draft, setDraft] = useState<{ id?: string; key: string; name: string } | null>(null);
  const query = useQuery({
    queryKey: ['admin', 'journeys', page, active],
    queryFn: () => adminApi.journeys(page, activeValue(active)),
  });
  const save = useMutation({
    mutationFn: () =>
      draft?.id
        ? adminApi.editJourney(draft.id, { name: draft.name })
        : adminApi.createJourney({ key: draft?.key ?? '', name: draft?.name ?? '' }),
    onSuccess: async () => {
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'journeys'] });
    },
  });
  const deactivate = useMutation({
    mutationFn: (id: string) => adminApi.deactivateJourney(id),
    onSuccess: async () => qc.invalidateQueries({ queryKey: ['admin', 'journeys'] }),
  });
  const error = query.error ?? save.error ?? deactivate.error;
  return (
    <div className="space-y-5 p-4 sm:p-6">
      <AdminHeader
        title="Journeys"
        description="Create pipelines and manage their Status and Field configuration."
        action={
          can('journeys_statuses', 'create') ? (
            <Button onClick={() => setDraft({ key: '', name: '' })}>Create Journey</Button>
          ) : undefined
        }
      />
      {error ? <Banner tone="error">{friendlyErrorMessage(error)}</Banner> : null}
      {draft ? (
        <JourneyForm
          draft={draft}
          setDraft={setDraft}
          save={() => save.mutate()}
          cancel={() => setDraft(null)}
          loading={save.isPending}
        />
      ) : null}
      <ActiveFilter
        id="journey-active"
        value={active}
        onChange={(value) => {
          setActive(value);
          setPage(1);
        }}
      />
      <AdminTable
        loading={query.isPending}
        headers={['Name', 'Stable key', 'State', 'Actions']}
        empty={!query.isPending && !query.data?.items.length}
      >
        {query.data?.items.map((journey) => (
          <tr className="border-b last:border-0" key={journey.id}>
            <td className="p-4 font-medium">{journey.name}</td>
            <td className="p-4 text-sm text-ink-soft">{journey.key}</td>
            <td className="p-4 text-sm">{journey.active ? 'Active' : 'Inactive'}</td>
            <td className="p-4">
              <div className="flex gap-2">
                <Link
                  className="text-sm font-medium underline"
                  to={`/admin/journeys/${journey.id}`}
                >
                  Manage
                </Link>
                {can('journeys_statuses', 'edit') ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setDraft({ id: journey.id, key: journey.key, name: journey.name })
                    }
                  >
                    Edit
                  </Button>
                ) : null}
                {can('journeys_statuses', 'delete') && journey.active ? (
                  <Button size="sm" variant="danger" onClick={() => deactivate.mutate(journey.id)}>
                    Deactivate
                  </Button>
                ) : null}
              </div>
            </td>
          </tr>
        ))}
      </AdminTable>
      {query.data ? (
        <PageControls
          page={query.data.page}
          pageSize={query.data.pageSize || ADMIN_PAGE_SIZE}
          total={query.data.total}
          onPage={setPage}
        />
      ) : null}
    </div>
  );
}

function JourneyForm({
  draft,
  setDraft,
  save,
  cancel,
  loading,
}: {
  draft: { id?: string; key: string; name: string };
  setDraft: (value: { id?: string; key: string; name: string }) => void;
  save: () => void;
  cancel: () => void;
  loading: boolean;
}) {
  return (
    <Card className="grid gap-3 p-4 sm:grid-cols-2">
      <Field label="Stable key" required>
        {({ inputId }) => (
          <Input
            id={inputId}
            disabled={Boolean(draft.id)}
            value={draft.key}
            onChange={(event) => setDraft({ ...draft, key: event.target.value })}
          />
        )}
      </Field>
      <Field label="Name" required>
        {({ inputId }) => (
          <Input
            id={inputId}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        )}
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <Button
          loading={loading}
          disabled={!draft.name || (!draft.id && !draft.key)}
          onClick={save}
        >
          Save Journey
        </Button>
        <Button variant="ghost" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
