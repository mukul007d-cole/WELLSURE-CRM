import { useDraggable } from '@dnd-kit/core';
import { Link } from 'react-router-dom';
import { RingAvatar } from '../../components/ui/RingAvatar';
import { cn } from '../../lib/cn';
import type { SellerListRow, Status } from '../../types/domain';
import { MoveStatusMenu } from './MoveStatusMenu';

export interface BoardCardProcess {
  processInstanceId: string;
  journeyId: string;
  ownerName: string | null;
}

/** The visual card, shared by the column and the drag overlay. */
export function BoardCardBody({
  row,
  ownerName,
  lifted,
  children,
}: {
  row: SellerListRow;
  ownerName: string | null;
  lifted?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-card border border-line bg-surface p-3 transition-shadow',
        lifted
          ? 'shadow-[var(--shadow-popover)] motion-safe:rotate-1'
          : 'shadow-[var(--shadow-card)] hover:border-line-strong',
      )}
    >
      <div className="flex items-start gap-2.5">
        <RingAvatar name={row.name} size={32} />
        <div className="min-w-0 flex-1">
          <Link
            to={`/sellers/${row.id}`}
            className="block truncate text-sm font-medium text-ink hover:underline"
          >
            {row.name}
          </Link>
          {(row.phone ?? row.email) ? (
            <p className="truncate text-xs text-ink-soft">{row.phone ?? row.email}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="truncate text-xs text-ink-soft">{ownerName ?? 'Unassigned'}</span>
        {children}
      </div>
    </div>
  );
}

export function BoardCard({
  row,
  process,
  status,
  statuses,
  canEdit,
  onMove,
}: {
  row: SellerListRow;
  process: BoardCardProcess;
  status: Status;
  statuses: Status[];
  canEdit: boolean;
  onMove: (status: Status) => void;
}) {
  // Always called; `disabled` is what turns dragging off, so the read-only
  // board keeps the same hook order as the editable one.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${row.id}::${process.processInstanceId}`,
    disabled: !canEdit,
    data: { row, process, fromStatus: status },
  });

  return (
    <li ref={setNodeRef} className={cn('list-none', isDragging && 'opacity-40')}>
      <div {...(canEdit ? attributes : {})} {...(canEdit ? listeners : {})}>
        <BoardCardBody row={row} ownerName={process.ownerName}>
          {canEdit ? (
            // Stops the menu button from starting a drag instead of opening.
            <div onPointerDown={(event) => event.stopPropagation()}>
              <MoveStatusMenu
                statuses={statuses}
                currentStatusId={status.id}
                onSelect={onMove}
                accessibleName={`Move ${row.name}`}
              />
            </div>
          ) : null}
        </BoardCardBody>
      </div>
    </li>
  );
}
