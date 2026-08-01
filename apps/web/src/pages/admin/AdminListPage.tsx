import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { adminApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';

type Kind = 'journeys' | 'fields' | 'users' | 'roles' | 'departments';
const meta = {
  journeys: { title: 'Journeys', module: 'journeys_statuses', detail: true },
  fields: { title: 'Fields', module: 'fields', detail: false },
  users: { title: 'Users', module: 'users', detail: false },
  roles: { title: 'Roles & permissions', module: 'roles_permissions', detail: true },
  departments: { title: 'Departments', module: 'users', detail: false },
} as const;

export function AdminListPage({ kind }: { kind: Kind }) {
  const { can } = useAuth(); const queryClient = useQueryClient();
  const [page, setPage] = useState(1); const [active, setActive] = useState('true');
  const [creating, setCreating] = useState(false); const [name, setName] = useState(''); const [key, setKey] = useState('');
  const [roleId, setRoleId] = useState(''); const [departmentId, setDepartmentId] = useState('');
  const current = meta[kind];
  const query = useQuery<{ items: Array<Record<string, unknown>> }>({ queryKey: ['admin', kind, page, active], queryFn: async () => {
    const flag = active === 'all' ? undefined : active === 'true';
    const result = kind === 'journeys' ? await adminApi.journeys(page, flag)
      : kind === 'fields' ? await adminApi.fields(page, flag)
      : kind === 'users' ? await adminApi.users({ page, ...(flag === undefined ? {} : { active: flag }) })
      : kind === 'roles' ? await adminApi.roles(page, flag)
      : await adminApi.departments(page, flag);
    return result as unknown as { items: Array<Record<string, unknown>> };
  }});
  const roleOptions = useQuery({ queryKey: ['admin', 'user-role-options'], queryFn: () => adminApi.roles(1, true), enabled: kind === 'users' });
  const departmentOptions = useQuery({ queryKey: ['admin', 'user-department-options'], queryFn: () => adminApi.departments(1, true), enabled: kind === 'users' });
  const create = useMutation({ mutationFn: async () => {
    if (kind === 'journeys') return adminApi.createJourney({ key, name });
    if (kind === 'fields') return adminApi.createField({ key, name, fieldType: 'text', validationRule: null, section: null, editMode: 'manual', source: 'manual' });
    if (kind === 'roles') return adminApi.createRole({ key, name });
    if (kind === 'departments') return adminApi.createDepartment({ key, name });
    return adminApi.createUser({ name, email: key, roleId, departmentId: departmentId || null, managerId: null });
  }, onSuccess: async () => { setCreating(false); setName(''); setKey(''); await queryClient.invalidateQueries({ queryKey: ['admin', kind] }); } });
  const action = useMutation({ mutationFn: async (row: Record<string, unknown>) => {
    const id = String(row.id);
    if (kind === 'journeys') return adminApi.deactivateJourney(id);
    if (kind === 'fields') return adminApi.deactivateField(id);
    if (kind === 'users') return adminApi.deactivateUser(id);
    if (kind === 'roles') return adminApi.deactivateRole(id);
    return adminApi.editDepartment(id, { name: String(row.name) });
  }, onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['admin', kind] }) });
  const rows = query.data?.items ?? [];
  const label = (value: unknown) => typeof value === 'string' ? value : '—';
  const createAction = kind === 'departments' ? 'create' : 'create';
  return <div className="space-y-5 p-4 sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-display text-2xl font-bold">{current.title}</h2><p className="text-sm text-ink-soft">Configuration is permission-driven and organization scoped.</p></div>{can(current.module, createAction) && <Button onClick={() => setCreating(!creating)}>Create</Button>}</div>
    {(query.isError || create.isError || action.isError) && <Banner tone="error">{friendlyErrorMessage(query.error ?? create.error ?? action.error)}</Banner>}
    {creating && <Card className="grid gap-3 p-4 sm:grid-cols-3"><Field label={kind === 'users' ? 'Email' : 'Stable key'} required>{({ inputId }) => <Input id={inputId} value={key} onChange={(e) => setKey(e.target.value)} />}</Field><Field label="Name" required>{({ inputId }) => <Input id={inputId} value={name} onChange={(e) => setName(e.target.value)} />}</Field>{kind === 'users' && <><Field label="Role" required>{({ inputId }) => <Select id={inputId} value={roleId} onChange={(e) => setRoleId(e.target.value)}><option value="">Select a role</option>{roleOptions.data?.items.map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}</Select>}</Field><Field label="Department">{({ inputId }) => <Select id={inputId} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}><option value="">No department</option>{departmentOptions.data?.items.map((department) => <option value={department.id} key={department.id}>{department.name}</option>)}</Select>}</Field><p className="self-center text-sm text-ink-soft">No password is collected. The user receives the existing password-reset invitation.</p></>}<Button className="self-end" disabled={kind === 'users' && !roleId} loading={create.isPending} onClick={() => create.mutate()}>Save</Button></Card>}
    <div className="flex items-center gap-2"><label htmlFor={`${kind}-active`} className="text-sm">Active</label><Select id={`${kind}-active`} className="w-40" value={active} onChange={(e) => { setActive(e.target.value); setPage(1); }}><option value="true">Active</option><option value="false">Inactive</option><option value="all">All</option></Select></div>
    <Card className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b text-xs uppercase text-ink-soft"><th className="p-4">Name</th><th className="p-4">Key / email</th><th className="p-4">State</th><th className="p-4">Actions</th></tr></thead><tbody>{rows.map((row) => <tr className="border-b last:border-0" key={label(row.id)}><td className="p-4 font-medium">{label(row.name)}</td><td className="p-4 text-sm text-ink-soft">{label(row.key ?? row.email)}</td><td className="p-4 text-sm">{row.active === false ? 'Inactive' : 'Active'}</td><td className="p-4"><div className="flex gap-2">{current.detail && <Link className="text-sm font-medium underline" to={`/admin/${kind}/${label(row.id)}`}>Manage</Link>}{row.active !== false && can(current.module, kind === 'users' ? 'deactivate' : kind === 'departments' ? 'edit' : kind === 'roles' ? 'edit' : 'delete') && <Button size="sm" variant="ghost" onClick={() => action.mutate(row)}>{kind === 'departments' ? 'Edit' : 'Deactivate'}</Button>}</div></td></tr>)}</tbody></table>{!query.isPending && rows.length === 0 && <p className="p-8 text-center text-ink-soft">No records found.</p>}</Card>
    <div className="flex justify-between"><Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-sm">Page {page}</span><Button variant="secondary" disabled={rows.length < 25} onClick={() => setPage(page + 1)}>Next</Button></div>
  </div>;
}
