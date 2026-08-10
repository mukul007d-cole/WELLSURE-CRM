import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { Pagination } from '../../components/ui/Pagination';
import { DataCell, DataRow, RowActions } from '../../components/ui/DataTable';
import { adminApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import { PageBody, PageHeader } from '../../components/layout/PageFrame';
import { usePageChrome } from '../../app/page-chrome';
import { ActiveFilter, AdminTable, activeValue, ADMIN_PAGE_SIZE } from './shared';

export function JourneysPage() {
  usePageChrome('Journeys', [['admin', 'journeys']]);
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
    <PageBody>
      <PageHeader
        title="Journeys"
        description="Create pipelines and manage their Status and Field configuration."
        actions={
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
        headers={['Name', 'Stable key', 'State', { label: 'Actions', align: 'right' as const }]}
        empty={!query.isPending && !query.data?.items.length}
      >
        {query.data?.items.map((journey) => (
          <DataRow key={journey.id}>
            <DataCell primary>{journey.name}</DataCell>
            <DataCell>{journey.key}</DataCell>
            <DataCell>{journey.active ? 'Active' : 'Inactive'}</DataCell>
            <DataCell align="right">
              {/* Manage stays outside RowActions — it is the row's primary
                  destination, not a hover-revealed extra. */}
              <div className="flex items-center justify-end gap-2">
                <Link
                  className="text-sm font-medium underline"
                  to={`/admin/journeys/${journey.id}`}
                >
                  Manage
                </Link>
                <RowActions>
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
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => deactivate.mutate(journey.id)}
                    >
                      Deactivate
                    </Button>
                  ) : null}
                </RowActions>
              </div>
            </DataCell>
          </DataRow>
        ))}
      </AdminTable>
      {query.data ? (
        <Pagination
          page={query.data.page}
          pageSize={query.data.pageSize || ADMIN_PAGE_SIZE}
          total={query.data.total}
          onPageChange={setPage}
        />
      ) : null}
    </PageBody>
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
