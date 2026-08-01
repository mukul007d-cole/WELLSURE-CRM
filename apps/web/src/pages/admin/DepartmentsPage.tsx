import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../app/AuthContext';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { adminApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import {
  ActiveFilter,
  AdminHeader,
  AdminTable,
  PageControls,
  activeValue,
  ADMIN_PAGE_SIZE,
} from './shared';

type DepartmentDraft = { id?: string; key: string; name: string };
export function DepartmentsPage() {
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
    <div className="space-y-5 p-4 sm:p-6">
      <AdminHeader
        title="Departments"
        description="Manage organization units used by User assignment and data scope."
        action={
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
        headers={['Name', 'Stable key', 'State', 'Actions']}
        empty={!query.isPending && !query.data?.items.length}
      >
        {query.data?.items.map((department) => (
          <tr className="border-b last:border-0" key={department.id}>
            <td className="p-4 font-medium">{department.name}</td>
            <td className="p-4 text-sm text-ink-soft">{department.key}</td>
            <td className="p-4 text-sm">{department.active ? 'Active' : 'Inactive'}</td>
            <td className="p-4">
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
