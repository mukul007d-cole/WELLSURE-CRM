import { Button, ButtonLink } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import type { StatusChangeVariables } from '../../lib/status-change';

/**
 * Shown whenever a status change is refused because the destination status
 * requires a field the lead doesn't have filled in yet — reused verbatim by
 * both the Board's Move menu/drag and the Seller List's inline status
 * control, since both trigger the identical underlying `editLead` rejection.
 */
export function StatusChangeRejectedDialog({
  variables,
  fieldLabel,
  onClose,
}: {
  variables: StatusChangeVariables;
  /** Null when the viewer's role can't read the field catalogue. */
  fieldLabel: string | null;
  onClose: () => void;
}) {
  const { row, fromStatus, toStatus } = variables;

  return (
    <Dialog
      title="That move needs more information first"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <ButtonLink to={`/sellers/${row.id}/edit`}>Open seller form</ButtonLink>
        </>
      }
    >
      <p>
        {/*
          Both status names come straight from configuration. The field label is
          a first-class variant rather than a fallback: a leads-only role can't
          read the field catalogue, and showing a raw UUID would be worse than
          saying less.
        */}
        Moving <strong className="font-medium text-ink">{row.name}</strong> from{' '}
        <strong className="font-medium text-ink">{fromStatus.name}</strong> to{' '}
        <strong className="font-medium text-ink">{toStatus.name}</strong> needs{' '}
        {fieldLabel ? (
          <>
            <strong className="font-medium text-ink">{fieldLabel}</strong> filled in first.
          </>
        ) : (
          <>a required field filled in first.</>
        )}
      </p>
      <p className="mt-3">
        {row.name} stayed in {fromStatus.name}. Fill the field in on the seller form, then move the
        card again.
      </p>
    </Dialog>
  );
}
