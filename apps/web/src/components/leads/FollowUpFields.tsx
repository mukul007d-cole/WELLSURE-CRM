import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';

export interface FollowUpDraft {
  /** A `datetime-local` value; converted to ISO only on submit. */
  dueAt: string;
  note: string;
}

export const EMPTY_FOLLOW_UP: FollowUpDraft = { dueAt: '', note: '' };

/**
 * When and why to call back. Shared by the status-change dialog and the
 * Seller 360 follow-up actions so a follow-up reads the same everywhere.
 */
export function FollowUpFields({
  value,
  onChange,
  required,
  error,
  hint,
}: {
  value: FollowUpDraft;
  onChange: (next: FollowUpDraft) => void;
  required?: boolean;
  error?: string | undefined;
  hint?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Follow-up date and time" required={required} error={error} hint={hint}>
        {({ inputId, describedBy }) => (
          <Input
            id={inputId}
            type="datetime-local"
            aria-describedby={describedBy}
            invalid={Boolean(error)}
            value={value.dueAt}
            onChange={(event) => onChange({ ...value, dueAt: event.target.value })}
          />
        )}
      </Field>
      <Field label="Follow-up note">
        {({ inputId, describedBy }) => (
          <Textarea
            id={inputId}
            rows={2}
            aria-describedby={describedBy}
            maxLength={2000}
            value={value.note}
            onChange={(event) => onChange({ ...value, note: event.target.value })}
          />
        )}
      </Field>
    </div>
  );
}
