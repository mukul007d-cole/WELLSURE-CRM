import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { adminApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import { PageBody, PageHeader } from '../../components/layout/PageFrame';
import { usePageChrome } from '../../app/page-chrome';
import { ActiveFilter, activeValue, loadAllPages } from './shared';
import { TeamEditor, type TeamDraft } from './TeamEditor';
import type { Team } from '../../types/domain';

/**
 * One Department, and the Teams inside it.
 *
 * Teams live here rather than under their own admin tab, mirroring how Statuses
 * live inside a Journey: a Team has no meaning outside the Department that
 * scopes it, and its member list is drawn from that Department's Users.
 */
export function DepartmentDetailPage() {
  const { departmentId = '' } = useParams();
  usePageChrome('Department', [['admin', 'department', departmentId]]);
  const { can } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [active, setActive] = useState('true');
  const [draft, setDraft] = useState<TeamDraft | null>(null);

  const department = useQuery({
    queryKey: ['admin', 'department', departmentId],
    queryFn: () => adminApi.department(departmentId),
  });
  const teams = useQuery({
    queryKey: ['admin', 'teams', departmentId, active],
    queryFn: () => adminApi.teams(departmentId, 1, activeValue(active)),
  });
  // Membership is confined to this Department's own active Users, so the picker
  // asks for exactly that set rather than every user in the organization.
  const candidates = useQuery({
    queryKey: ['admin', 'department-users', departmentId],
    queryFn: () =>
      loadAllPages((page, pageSize) =>
        adminApi.users({ page, pageSize, departmentId, active: true }),
      ),
  });

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['admin', 'teams', departmentId] });
    await qc.invalidateQueries({ queryKey: ['admin', 'department', departmentId] });
  };
  const renameDepartment = useMutation({
    mutationFn: () =>
      adminApi.editDepartment(departmentId, { name: name || department.data?.name || '' }),
    onSuccess: refresh,
  });
  const saveTeam = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      if (draft.id) {
        await adminApi.editTeam(draft.id, { name: draft.name });
        await adminApi.saveTeamMembers(draft.id, draft.members);
        return;
      }
      await adminApi.createTeam(departmentId, {
        key: draft.key,
        name: draft.name,
        members: draft.members,
      });
    },
    onSuccess: async () => {
      setDraft(null);
      await refresh();
    },
  });
  const deactivateTeam = useMutation({
    mutationFn: (id: string) => adminApi.deactivateTeam(id),
    onSuccess: refresh,
  });

  const error =
    department.error ??
    teams.error ??
    candidates.error ??
    renameDepartment.error ??
    saveTeam.error ??
    deactivateTeam.error;

  return (
    <PageBody>
      <PageHeader
        title={department.data?.name ?? 'Department'}
        description="Manage this Department's identity and the Teams inside it."
        actions={
          <Link to="/admin/departments" className="text-xs text-ink-soft hover:text-ink">
            ← Departments
          </Link>
        }
      />
      {error ? <Banner tone="error">{friendlyErrorMessage(error)}</Banner> : null}

      {can('users', 'edit') ? (
        <Card className="flex gap-3 p-4">
          <Field label="Department name" className="flex-1">
            {({ inputId }) => (
              <Input
                id={inputId}
                value={name}
                placeholder={department.data?.name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          <Button
            className="self-end"
            loading={renameDepartment.isPending}
            onClick={() => renameDepartment.mutate()}
          >
            Save Department
          </Button>
        </Card>
      ) : null}

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-lg font-semibold">Teams</h3>
          {can('users', 'create') ? (
            <Button size="sm" onClick={() => setDraft({ key: '', name: '', members: [] })}>
              Create Team
            </Button>
          ) : null}
        </div>
        {/*
          The converse of the note on the role editor. Two things in this
          product are called "team"; whichever one an admin is looking at
          should say so (ADR-0014).
        */}
        <p className="rounded-control bg-paper px-3 py-2 text-xs text-ink-soft">
          Teams group this Department&rsquo;s Users for organization and lead routing. They do not
          affect what anyone can see — the &ldquo;Team (reporting line)&rdquo; data scope on a role
          follows the org chart instead.
        </p>

        <ActiveFilter id="team-active" value={active} onChange={setActive} />

        {draft ? (
          <TeamEditor
            draft={draft}
            setDraft={setDraft}
            candidates={candidates.data ?? []}
            save={() => saveTeam.mutate()}
            cancel={() => setDraft(null)}
            loading={saveTeam.isPending}
          />
        ) : null}

        {teams.isPending ? (
          <p className="text-sm text-ink-soft" role="status">
            Loading Teams…
          </p>
        ) : null}
        {!teams.isPending && !teams.data?.items.length ? (
          <p className="text-sm text-ink-soft">No Teams in this Department yet.</p>
        ) : null}

        <ul className="divide-y">
          {teams.data?.items.map((team) => (
            <li className="flex flex-wrap items-center justify-between gap-3 py-3" key={team.id}>
              <div>
                <span className="font-medium">{team.name}</span>
                <span className="ml-2 text-sm text-ink-soft">
                  {team.active ? '' : 'Inactive · '}
                  {describeMembers(team)}
                </span>
              </div>
              <div className="flex gap-2">
                {can('users', 'edit') && team.active ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setDraft(fromTeam(team))}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => deactivateTeam.mutate(team.id)}
                    >
                      Deactivate
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </PageBody>
  );
}

function fromTeam(team: Team): TeamDraft {
  return {
    id: team.id,
    key: team.key,
    name: team.name,
    members: team.members.map(({ userId, isLeader }) => ({ userId, isLeader })),
  };
}

function describeMembers(team: Team): string {
  const leaders = team.members.filter((member) => member.isLeader);
  const names = leaders.map((leader) => leader.user?.name ?? leader.userId).join(', ');
  const size = `${team.members.length} member${team.members.length === 1 ? '' : 's'}`;
  return leaders.length === 0 ? `${size} · no Team Leader` : `${size} · led by ${names}`;
}
