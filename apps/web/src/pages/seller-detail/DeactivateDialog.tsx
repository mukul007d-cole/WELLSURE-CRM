import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { friendlyErrorMessage } from '../../lib/api-error';

export function DeactivateDialog({
  sellerName,
  onClose,
  onConfirm,
  pending,
  error,
}: {
  sellerName: string;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
  error: unknown;
}) {
  return (
    <Dialog
      title="Deactivate seller"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={pending} onClick={onConfirm}>
            {pending ? 'Deactivating…' : 'Deactivate'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink">
          <span className="font-medium">{sellerName}</span> will stop appearing in lists and on the
          board.
        </p>
        <p className="text-sm text-ink-soft">
          The record and its history are kept — deactivation is recorded on the timeline, not a
          delete.
        </p>
        {error ? <Banner tone="error">{friendlyErrorMessage(error)}</Banner> : null}
      </div>
    </Dialog>
  );
}
