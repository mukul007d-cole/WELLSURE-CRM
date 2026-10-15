import { useState } from 'react';
import { friendlyErrorMessage } from '../../lib/api-error';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { FollowUpFields, type FollowUpDraft } from './FollowUpFields';
import { fromDateTimeLocal, toDateTimeLocal } from './status-entry';

/**
 * Pick a follow-up date (and an optional note) outside a status change:
 * scheduling one from the record, or rescheduling an open one.
 */
export function FollowUpDialog({
  title,
  description,
  submitLabel,
  initial,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  title: string;
  description?: string;
  submitLabel: string;
  initial?: { dueAt?: string | null; note?: string | null };
  pending: boolean;
  error: unknown;
  onSubmit: (value: { dueAt: string; note: string | null }) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<FollowUpDraft>({
    dueAt: toDateTimeLocal(initial?.dueAt),
    note: initial?.note ?? '',
  });
  const [attempted, setAttempted] = useState(false);
  const dueAt = fromDateTimeLocal(draft.dueAt);

  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={pending}
            onClick={() => {
              setAttempted(true);
              if (dueAt === null) return;
              onSubmit({ dueAt, note: draft.note.trim() || null });
            }}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      {description ? <p className="mb-4">{description}</p> : null}
      {error ? (
        <div className="mb-4">
          <Banner tone="error">{friendlyErrorMessage(error)}</Banner>
        </div>
      ) : null}
      <FollowUpFields
        value={draft}
        onChange={setDraft}
        required
        error={attempted && dueAt === null ? 'Choose when to follow up.' : undefined}
      />
    </Dialog>
  );
}
