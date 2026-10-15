import { useState } from 'react';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { friendlyErrorMessage } from '../../lib/api-error';
import type { FollowUp } from '../../types/domain';
import { absoluteDue, defaultRescheduleAt } from './due-date';

export type FollowUpDialogMode = 'complete' | 'reschedule' | 'cancel';

export interface FollowUpUpdate {
  action: 'complete' | 'reopen' | 'reschedule' | 'cancel';
  dueAt?: string;
  note?: string;
}

const COPY: Record<FollowUpDialogMode, { title: string; confirm: string }> = {
  complete: { title: 'Mark follow-up done', confirm: 'Mark done' },
  reschedule: { title: 'Reschedule follow-up', confirm: 'Reschedule' },
  cancel: { title: 'Cancel follow-up', confirm: 'Cancel follow-up' },
};

/**
 * The one dialog behind Done, Reschedule and Cancel. Each needs the same
 * frame — what you're acting on, an optional note, a confirm — and only
 * reschedule adds a date.
 */
export function FollowUpActionDialog({
  followUp,
  mode,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  followUp: FollowUp;
  mode: FollowUpDialogMode;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (update: FollowUpUpdate) => void;
}) {
  const [note, setNote] = useState('');
  const [dueAt, setDueAt] = useState(() => defaultRescheduleAt(followUp.dueDate));
  const copy = COPY[mode];
  const dueAtValid = mode !== 'reschedule' || !Number.isNaN(Date.parse(dueAt));

  function submit() {
    // A blank note is left out, so the server keeps whatever note is there.
    const trimmed = note.trim();
    onConfirm({
      action: mode,
      ...(mode === 'reschedule' ? { dueAt: new Date(dueAt).toISOString() } : {}),
      ...(trimmed ? { note: trimmed } : {}),
    });
  }

  return (
    <Dialog
      title={copy.title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {mode === 'cancel' ? 'Keep it' : 'Back'}
          </Button>
          <Button
            variant={mode === 'cancel' ? 'danger' : 'primary'}
            loading={pending}
            disabled={!dueAtValid}
            onClick={submit}
          >
            {copy.confirm}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p>
          <span className="font-medium text-ink">{followUp.leadName}</span>, due{' '}
          {absoluteDue(followUp.dueDate)}.
        </p>
        {error ? <Banner tone="error">{friendlyErrorMessage(error)}</Banner> : null}
        {mode === 'reschedule' ? (
          <Field label="New date and time" required>
            {({ inputId }) => (
              <Input
                id={inputId}
                type="datetime-local"
                value={dueAt}
                invalid={!dueAtValid}
                onChange={(event) => setDueAt(event.target.value)}
              />
            )}
          </Field>
        ) : null}
        <Field
          label="Note"
          hint={followUp.note ? 'Leave blank to keep the current note.' : 'Optional.'}
        >
          {({ inputId, describedBy }) => (
            <Textarea
              id={inputId}
              rows={3}
              aria-describedby={describedBy}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
