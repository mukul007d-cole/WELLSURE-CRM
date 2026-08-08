import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../app/AuthContext';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { adminApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import type { AdminUser } from '../../types/domain';
import { SearchableSelect } from './SearchableSelect';
import { Toolbar } from '../../components/layout/PageFrame';
import { ActiveFilter, AdminTable, PageControls, activeValue, ADMIN_PAGE_SIZE } from './shared';

type UserDraft = {
  id?: string;
  name: string;
  email: string;
  roleId: string;
  departmentId: string;
  managerId: string;
};
const emptyUser = (): UserDraft => ({
  name: '',
  email: '',
  roleId: '',
  departmentId: '',
  managerId: '',
});
export function UsersPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [active, setActive] = useState('true');
  const [roleFilter, setRoleFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [draft, setDraft] = useState<UserDraft | null>(null);
  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchDraft);
      setPage(1);
    }, 250);
    return () => clearTimeout(handle);
  }, [searchDraft]);
  const query = useQuery({
    queryKey: ['admin', 'users', page, active, roleFilter, departmentFilter, search],
    queryFn: () => {
      const activeFilter = activeValue(active);
      return adminApi.users({
        page,
        ...(activeFilter === undefined ? {} : { active: activeFilter }),
        ...(roleFilter ? { roleId: roleFilter } : {}),
        ...(departmentFilter ? { departmentId: departmentFilter } : {}),
        ...(search ? { search } : {}),
      });
    },
  });
  const roles = useQuery({
    queryKey: ['admin', 'roles', 'filters'],
    queryFn: () => adminApi.roles(1, true),
  });
  const departments = useQuery({
    queryKey: ['admin', 'departments', 'filters'],
    queryFn: () => adminApi.departments(1, true),
  });
  const loadRoles = useCallback((nextPage: number) => adminApi.roles(nextPage, true), []);
  const loadDepartments = useCallback(
    (nextPage: number) => adminApi.departments(nextPage, true),
    [],
  );
  const loadManagers = useCallback(
    (nextPage: number) => adminApi.users({ page: nextPage, active: true }),
    [],
  );
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: draft?.name ?? '',
        email: draft?.email ?? '',
        roleId: draft?.roleId ?? '',
        departmentId: draft?.departmentId || null,
        managerId: draft?.managerId || null,
      };
      return draft?.id ? adminApi.editUser(draft.id, body) : adminApi.createUser(body);
    },
    onSuccess: async () => {
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
  const deactivate = useMutation({
    mutationFn: adminApi.deactivateUser,
    onSuccess: async () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
  const error = query.error ?? save.error ?? deactivate.error;
  return (
    <div className="space-y-4">
      {error ? <Banner tone="error">{friendlyErrorMessage(error)}</Banner> : null}
      {draft ? (
        <UserEditor
          draft={draft}
          setDraft={setDraft}
          loadRoles={loadRoles}
          loadDepartments={loadDepartments}
          loadManagers={loadManagers}
          save={() => save.mutate()}
          cancel={() => setDraft(null)}
          loading={save.isPending}
        />
      ) : null}
      <Toolbar
        trailing={
          can('users', 'create') ? (
            <Button size="sm" onClick={() => setDraft(emptyUser())}>
              Create user
            </Button>
          ) : undefined
        }
      >
        <Input
          className="w-full sm:w-56"
          aria-label="Search users"
          placeholder="Search users"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
        />
        <Select
          aria-label="Filter by role"
          value={roleFilter}
          onChange={(event) => {
            setRoleFilter(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All roles</option>
          {roles.data?.items.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter by department"
          value={departmentFilter}
          onChange={(event) => {
            setDepartmentFilter(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All departments</option>
          {departments.data?.items.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </Select>
        <ActiveFilter
          id="user-active"
          value={active}
          onChange={(value) => {
            setActive(value);
            setPage(1);
          }}
        />
      </Toolbar>
      <AdminTable
        loading={query.isPending}
        headers={['Name', 'Email', 'Role', 'Department', 'State', 'Actions']}
        empty={!query.isPending && !query.data?.items.length}
      >
        {query.data?.items.map((user) => (
          <tr className="border-b last:border-0" key={user.id}>
            <td className="p-4 font-medium">{user.name}</td>
            <td className="p-4 text-sm">{user.email}</td>
            <td className="p-4 text-sm">
              {roles.data?.items.find((role) => role.id === user.roleId)?.name ?? user.roleId}
            </td>
            <td className="p-4 text-sm">
              {departments.data?.items.find((department) => department.id === user.departmentId)
                ?.name ?? '—'}
            </td>
            <td className="p-4 text-sm">{user.active ? 'Active' : 'Inactive'}</td>
            <td className="p-4">
              <div className="flex gap-2">
                {can('users', 'edit') ? (
                  <Button size="sm" variant="ghost" onClick={() => setDraft(fromUser(user))}>
                    Edit
                  </Button>
                ) : null}
                {can('users', 'deactivate') && user.active ? (
                  <Button size="sm" variant="danger" onClick={() => deactivate.mutate(user.id)}>
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
function fromUser(user: AdminUser): UserDraft {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roleId: user.roleId,
    departmentId: user.departmentId ?? '',
    managerId: user.managerId ?? '',
  };
}
function UserEditor({
  draft,
  setDraft,
  loadRoles,
  loadDepartments,
  loadManagers,
  save,
  cancel,
  loading,
}: {
  draft: UserDraft;
  setDraft: (draft: UserDraft) => void;
  loadRoles: Parameters<typeof SearchableSelect>[0]['loadPage'];
  loadDepartments: Parameters<typeof SearchableSelect>[0]['loadPage'];
  loadManagers: Parameters<typeof SearchableSelect>[0]['loadPage'];
  save: () => void;
  cancel: () => void;
  loading: boolean;
}) {
  return (
    <Card className="grid gap-3 p-4 sm:grid-cols-2">
      <Field label="Name" required>
        {({ inputId }) => (
          <Input
            id={inputId}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        )}
      </Field>
      <Field label="Email" required>
        {({ inputId }) => (
          <Input
            id={inputId}
            type="email"
            value={draft.email}
            onChange={(event) => setDraft({ ...draft, email: event.target.value })}
          />
        )}
      </Field>
      <Field label="Role" required>
        {({ inputId }) => (
          <SearchableSelect
            id={inputId}
            value={draft.roleId}
            onChange={(roleId) => setDraft({ ...draft, roleId })}
            loadPage={loadRoles}
            placeholder="Select a role"
          />
        )}
      </Field>
      <Field label="Department">
        {({ inputId }) => (
          <SearchableSelect
            id={inputId}
            value={draft.departmentId}
            onChange={(departmentId) => setDraft({ ...draft, departmentId })}
            loadPage={loadDepartments}
            placeholder="No department"
          />
        )}
      </Field>
      <Field label="Manager">
        {({ inputId }) => (
          <SearchableSelect
            id={inputId}
            value={draft.managerId}
            onChange={(managerId) => setDraft({ ...draft, managerId })}
            loadPage={loadManagers}
            placeholder="No manager"
          />
        )}
      </Field>
      <p className="self-center text-sm text-ink-soft">
        Creating a user sends the existing password-reset invitation. No plaintext password is
        accepted or sent.
      </p>
      <div className="flex gap-2 sm:col-span-2">
        <Button
          loading={loading}
          disabled={!draft.name || !draft.email || !draft.roleId}
          onClick={save}
        >
          Save User
        </Button>
        <Button variant="ghost" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
