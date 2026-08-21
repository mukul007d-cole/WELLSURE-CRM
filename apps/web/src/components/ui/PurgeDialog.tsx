import { useState } from 'react';
import { ApiError } from '../../lib/api-error';
import { Banner } from './Banner';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Field } from './Field';
import { Input } from './Input';

interface PurgeDialogProps {
  /** What kind of thing this is, in the admin's words — "Journey", "Field". */
  entityLabel: string;
  /** The stable key the admin must type. Never the display name. */
  entityKey: string;
  entityName: string;
  onCancel: () => void;
  onConfirm: () => void;
  loading?: boolean;
  error?: unknown;
}

/**
 * The confirmation for a purge, which is the only irreversible action in the
 * product.
 *
 * Two things it does that the deactivate controls deliberately do not:
 *
 * - **It says the removal is permanent**, because it is. Deactivation is
 *   reversible and its buttons act immediately; this one cannot be, so it asks.
 * - **It requires the entity's stable key to be typed.** The key rather than
 *   the display name: names are editable, may repeat between records, and may
 *   contain characters that make retyping a coin flip, whereas the key is
 *   unique per organization and immutable after creation. The purge control
 *   sits one hover away from Edit, which is exactly the situation type-to-
 *   confirm exists for.
 *
 * A `dependency_conflict` is rendered in place, listing what still references
 * the entity, so the admin learns *why* without leaving the dialog. The counts
 * come from the real operation's refusal rather than from a preflight endpoint,
 * so there is no second opinion that could disagree with it.
 */
export function PurgeDialog({
  entityLabel,
  entityKey,
  entityName,
  onCancel,
  onConfirm,
  loading = false,
  error,
}: PurgeDialogProps) {
  const [typed, setTyped] = useState('');
  const matches = typed === entityKey;
  const conflict =
    error instanceof ApiError && error.code === 'dependency_conflict' ? error.details : undefined;

  return (
    <Dialog
      title={`Permanently delete this ${entityLabel}?`}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!matches} loading={loading} onClick={onConfirm}>
            Permanently delete
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <p>
          <strong>{entityName}</strong> will be removed from the database entirely.{' '}
          <strong>This cannot be undone</strong> — it is not the same as deactivating, and there is
          no way to restore it afterwards.
        </p>
        <p>
          An entry in the audit log will record what was deleted and who deleted it. That entry is
          the only record that will survive.
        </p>
        {conflict ? (
          <Banner tone="error">
            <span>This {entityLabel} is still in use and cannot be deleted:</span>
            <ul className="mt-1 list-disc pl-5">
              {Object.entries(conflict).map(([relationship, count]) => (
                <li key={relationship}>
                  {relationship}: {String(count)}
                </li>
              ))}
            </ul>
          </Banner>
        ) : null}
        <Field label={`Type ${entityKey} to confirm`}>
          {({ inputId }) => (
            <Input
              id={inputId}
              value={typed}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
