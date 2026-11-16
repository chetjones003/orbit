import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { LIST_DEFAULT_WIDTH, LIST_MAX_WIDTH, LIST_MIN_WIDTH } from './side-list-width';

/** Pixels a single arrow-key press moves the edge. */
const RESIZE_STEP = 16;

export interface ListResizeHandleProps {
  /** The current width in pixels. */
  width: number;
  /** Asks for a new width, from a drag, the keyboard, or a double click. The caller clamps it. */
  onResize(width: number): void;
}

/** The right edge of the left panel. Drag it to resize; arrow keys nudge it; a double click restores the default. */
export function ListResizeHandle({ width, onResize }: ListResizeHandleProps) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  // The edge moves with the pointer: dragging right makes the panel wider.
  const startDrag = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width };
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const start = drag.current;
    if (start) onResize(start.startWidth + (event.clientX - start.startX));
  };
  const endDrag = (): void => {
    drag.current = null;
  };
  const nudge = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onResize(width - RESIZE_STEP);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      onResize(width + RESIZE_STEP);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize lists panel"
      aria-valuemin={LIST_MIN_WIDTH}
      aria-valuemax={LIST_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      className="side-list-resize"
      title="Drag to resize. Double-click to reset."
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onResize(LIST_DEFAULT_WIDTH)}
      onKeyDown={nudge}
    />
  );
}
