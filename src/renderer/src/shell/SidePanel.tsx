import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { IssueDetailView } from '../issues/IssueDetail';
import { Icon } from '../icons';
import type { ItemRef } from './SideList';
import type { MotionMode } from './motion';

/** open is the resting state; closing and expanding play the animation that ends the panel. */
export type SidePanelState = 'open' | 'closing' | 'expanding';

export interface SidePanelProps {
  item: ItemRef;
  signedInLogin: string;
  state: SidePanelState;
  /** Width in pixels. The stack keeps it within bounds. */
  width: number;
  /** In fade mode the panel keeps its width while it fades, instead of growing to full screen. */
  motion: MotionMode;
  /** Asks for a new width, from a drag or the keyboard. */
  onResize(width: number): void;
  /** Starts the grow-to-full animation. The caller opens the item full screen when it ends. */
  onExpand(): void;
  /** Starts the close animation. The caller removes the panel when it ends. */
  onClose(): void;
  /** Opens another item from inside the panel, with the default behaviour. */
  onOpenItem(item: ItemRef): void;
}

/** Pixels a single arrow-key press moves the edge. */
const RESIZE_STEP = 16;

/** The item in the right-hand side panel, with its own header. */
export function SidePanel({
  item,
  signedInLogin,
  state,
  width,
  motion,
  onResize,
  onExpand,
  onClose,
  onOpenItem
}: SidePanelProps) {
  const label = item.kind === 'pull' ? 'Pull request' : 'Issue';
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  // The edge moves with the pointer: dragging left makes the panel wider.
  const startDrag = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width };
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const start = drag.current;
    if (start) onResize(start.startWidth + (start.startX - event.clientX));
  };
  const endDrag = (): void => {
    drag.current = null;
  };
  const nudge = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onResize(width + RESIZE_STEP);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      onResize(width - RESIZE_STEP);
    }
  };

  return (
    <div
      className={`item-side-slot is-${state}`}
      // While expanding in full motion, the CSS sets the width so the panel can grow to fill the workspace.
      style={state === 'expanding' && motion === 'full' ? undefined : { flexBasis: width }}
    >
      <div
        className="item-side-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={nudge}
      />
      <aside className="item-side-panel" aria-label={`${label} #${item.number} in ${item.repoFullName}`}>
        <header className="item-side-head">
          <span className="item-side-ref">
            <Icon name={item.kind === 'pull' ? 'pull' : 'issue'} size={14} />
            <span className="item-side-kind">{label}</span>
            <span className="item-side-repo">
              {item.repoFullName} <span className="item-side-number">#{item.number}</span>
            </span>
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={`Open ${label.toLowerCase()} #${item.number} full screen`}
            title="Open full screen"
            onClick={onExpand}
          >
            <Icon name="expand" size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={`Close ${label.toLowerCase()} #${item.number}`}
            title="Close"
            onClick={onClose}
          >
            <Icon name="close" size={14} />
          </button>
        </header>
        <IssueDetailView
          key={`${item.repoFullName}#${item.number}`}
          repoFullName={item.repoFullName}
          number={item.number}
          signedInLogin={signedInLogin}
          kind={item.kind}
          onOpenIssue={(repoFullName, number, kind) => onOpenItem({ repoFullName, number, kind })}
          variant="panel"
        />
      </aside>
    </div>
  );
}
