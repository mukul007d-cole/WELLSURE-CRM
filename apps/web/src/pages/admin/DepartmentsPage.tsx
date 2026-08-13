import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

type DepartmentDraft = { id?: string; key: string; name: string };
export function DepartmentsPage() {
  usePageChrome('Departments', [['admin', 'departments']]);
  const { can } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [active, setActive] = useState('true');
  const [draft, setDraft] = useState<DepartmentDraft | null>(null);
  const query = useQuery({
    queryKey: ['admin', 'departments', page, active],
    queryFn: () => adminApi.departments(page, activeValue(active)),
  });
  const save = useMutation({
    mutationFn: () =>
      draft?.id
        ? adminApi.editDepartment(draft.id, { name: draft.name })
        : adminApi.createDepartment({ key: draft?.key ?? '', name: draft?.name ?? '' }),
    onSuccess: async () => {
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'departments'] });
    },
  });
  const error = query.error ?? save.error;
  return (
    <PageBody>
      <PageHeader
        title="Departments"
        description="Manage organization units used by User assignment and data scope."
        actions={
          can('users', 'create') ? (
            <Button onClick={() => setDraft({ key: '', name: '' })}>Create Department</Button>
          ) : undefined
        }
      />
      {error ? <Banner tone="error">{friendlyErrorMessage(error)}</Banner> : null}
      {draft ? (
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
              loading={save.isPending}
              disabled={!draft.name || (!draft.id && !draft.key)}
              onClick={() => save.mutate()}
            >
              Save Department
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}
      <ActiveFilter
        id="department-active"
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
        {query.data?.items.map((department) => (
          <DataRow key={department.id}>
            <DataCell primary>{department.name}</DataCell>
            <DataCell>{department.key}</DataCell>
            <DataCell>{department.active ? 'Active' : 'Inactive'}</DataCell>
            <DataCell align="right">
              <RowActions>
                {can('users', 'edit') ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setDraft({ id: department.id, key: department.key, name: department.name })
                    }
                  >
                    Edit
                  </Button>
                ) : null}
                {/* Where this Department's Teams are administered. */}
                <Link
                  to={`/admin/departments/${department.id}`}
                  className="text-sm text-ink-soft hover:text-ink"
                >
                  Manage
                </Link>
              </RowActions>
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
