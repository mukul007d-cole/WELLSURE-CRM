import { KeyboardCode, type KeyboardCoordinateGetter } from '@dnd-kit/core';

/**
 * dnd-kit's stock keyboard sensor nudges by 25px per arrow press, which is
 * meaningless across ~18rem columns. This snaps to the next droppable column
 * instead, so one press moves one column.
 *
 * Vertical keys are ignored: cards are ordered by the server (updatedAt desc),
 * so there is no meaningful "up" target within a column.
 */
export const adjacentColumnCoordinates: KeyboardCoordinateGetter = (
  event,
  { context: { collisionRect, droppableRects, droppableContainers } },
) => {
  const code = event.code as KeyboardCode;
  if (code !== KeyboardCode.Right && code !== KeyboardCode.Left) return undefined;
  if (!collisionRect) return undefined;

  event.preventDefault();

  // Columns in visual order, left to right.
  const columns = droppableContainers
    .getEnabled()
    .flatMap((container) => {
      const rect = droppableRects.get(container.id);
      return rect ? [{ id: container.id, rect }] : [];
    })
    .sort((left, right) => left.rect.left - right.rect.left);

  if (columns.length === 0) return undefined;

  const currentIndex = columns.findIndex((column) => column.rect.left > collisionRect.left - 1);
  const anchor = currentIndex === -1 ? columns.length - 1 : currentIndex;
  const nextIndex = code === KeyboardCode.Right ? anchor + 1 : anchor - 1;
  const target = columns[nextIndex];
  if (!target) return undefined;

  return { x: target.rect.left, y: target.rect.top };
};
