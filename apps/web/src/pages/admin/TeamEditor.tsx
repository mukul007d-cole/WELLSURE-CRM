import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import type { AdminUser, TeamMember } from '../../types/domain';

export type TeamDraft = {
  id?: string;
  key: string;
  name: string;
  members: TeamMember[];
};

/**
 * Create or edit one Team.
 *
 * The member list offers only the Department's own active Users, because that
 * is the rule the API and the database both enforce — offering anyone else
 * would just be a 400 waiting to happen.
 */
export function TeamEditor({
  draft,
  setDraft,
  candidates,
  save,
  cancel,
  loading,
}: {
  draft: TeamDraft;
  setDraft: (draft: TeamDraft) => void;
  candidates: AdminUser[];
  save: () => void;
  cancel: () => void;
  loading: boolean;
}) {
  const member = (userId: string) => draft.members.find((row) => row.userId === userId);
  const setMember = (userId: string, next: TeamMember | null) =>
    setDraft({
      ...draft,
      members: [
        ...draft.members.filter((row) => row.userId !== userId),
        ...(next === null ? [] : [next]),
      ],
    });
  const hasLeader = draft.members.some((row) => row.isLeader);

  return (
    <div className="space-y-3 rounded-control border bg-paper p-3">
      <div className="grid gap-3 sm:grid-cols-2">
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
      </div>

      <fieldset>
        <legend className="font-display text-sm font-bold text-ink">Members</legend>
        <p className="mb-2 text-xs text-ink-soft">
          Only this Department&rsquo;s active Users can join. A Team needs at least one Team Leader.
        </p>
        {candidates.length === 0 ? (
          <p className="text-sm text-ink-soft">
            This Department has no active Users yet. Add Users to it before creating a Team.
          </p>
        ) : (
          <ul className="divide-y">
            {candidates.map((user) => {
              const row = member(user.id);
              return (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 py-2"
                  key={user.id}
                >
                  <Checkbox
                    label={`${user.name} (${user.email})`}
                    checked={Boolean(row)}
                    onChange={(event) =>
                      setMember(
                        user.id,
                        event.target.checked ? { userId: user.id, isLeader: false } : null,
                      )
                    }
                  />
                  <Checkbox
                    label="Team Leader"
                    disabled={!row}
                    checked={row?.isLeader ?? false}
                    onChange={(event) =>
                      setMember(user.id, { userId: user.id, isLeader: event.target.checked })
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      {draft.members.length > 0 && !hasLeader ? (
        <p className="text-sm text-danger" role="alert">
          Select at least one Team Leader.
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button
          loading={loading}
          disabled={!draft.name || (!draft.id && !draft.key) || !hasLeader}
          onClick={save}
        >
          Save Team
        </Button>
        <Button variant="ghost" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
