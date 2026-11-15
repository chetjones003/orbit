import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject
} from 'react';

/** Pointer travel before a press becomes a drag, so a click on a card is still a click. */
const DRAG_THRESHOLD_PX = 5;
/** How long the other cards take to slide into their new places. */
const SLIDE_MS = 180;
/** Form controls inside a card keep their own input. A title button still opens on click, and drags when moved. */
const NOT_DRAGGABLE = 'select, input, textarea, label';

/** A place a card can be dropped: a drop cell (a column, or a column within a swimlane) and a slot in it. */
export interface DropSlot {
  cellKey: string;
  /** Position among the cell's cards, not counting the dragged card. */
  index: number;
}

interface Session {
  itemId: string;
  card: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  origin: DropSlot;
  activated: boolean;
  ghost: HTMLElement | null;
  /** Each drop cell's cards, top to bottom, with their vertical midpoints as they were before the drag moved anything. */
  cells: Map<string, Array<{ id: string; mid: number }>> | null;
  move: (event: PointerEvent) => void;
  up: (event: PointerEvent) => void;
  cancel: () => void;
  key: (event: KeyboardEvent) => void;
}

export interface CardDrag {
  /** Attach to the element that holds every drop cell and card. */
  rootRef: RefObject<HTMLDivElement | null>;
  /** The card being dragged, or null. It is drawn only as the copy under the pointer. */
  draggingId: string | null;
  /** Height of the card being dragged, so the slot it leaves behind is the same size. */
  slotHeight: number;
  /** The slot index in this cell while a drag is over it, or null. */
  slotFor: (cellKey: string) => number | null;
  /** Event handlers for a card. Pending cards pass `enabled` false and cannot be dragged. */
  cardHandlers: (
    itemId: string,
    enabled: boolean
  ) => { onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void };
}

/**
 * Pointer-driven card drag. The card is copied under the pointer and follows it, its place becomes a slot in
 * whichever cell the pointer is over, and the other cards slide aside to make room. The drop calls `onDrop` with
 * the cell, the slot index, and the slot the card came from.
 */
export function useCardDrag(onDrop: (target: DropSlot, itemId: string, origin: DropSlot) => void): CardDrag {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const onDropRef = useRef(onDrop);
  const session = useRef<Session | null>(null);
  const slotRef = useRef<DropSlot | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [slotHeight, setSlotHeight] = useState(0);
  const [slot, setSlot] = useState<DropSlot | null>(null);

  useLayoutEffect(() => {
    onDropRef.current = onDrop;
  });

  // Every card that moved since the last render slides from where it was to where it is now.
  const lastPositions = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const next = new Map<string, { x: number; y: number }>();
    for (const card of root.querySelectorAll<HTMLElement>('[data-card-id]')) {
      const id = card.dataset.cardId ?? '';
      const rect = card.getBoundingClientRect();
      next.set(id, { x: rect.left, y: rect.top });
      const before = lastPositions.current.get(id);
      if (!before) continue;
      const dx = before.x - rect.left;
      const dy = before.y - rect.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      card.style.transition = 'none';
      card.style.transform = `translate(${dx}px, ${dy}px)`;
      void card.offsetWidth; // Commit the start position before the slide begins.
      card.style.transition = `transform ${SLIDE_MS}ms ease`;
      card.style.transform = '';
    }
    lastPositions.current = next;
  });

  const place = (next: DropSlot | null) => {
    const current = slotRef.current;
    if (current?.cellKey === next?.cellKey && current?.index === next?.index) return;
    slotRef.current = next;
    setSlot(next);
  };

  const finish = (active: Session, commit: boolean) => {
    window.removeEventListener('pointermove', active.move);
    window.removeEventListener('pointerup', active.up);
    window.removeEventListener('pointercancel', active.cancel);
    window.removeEventListener('keydown', active.key);
    if (session.current === active) session.current = null;
    const landed = active.activated ? slotRef.current : null;
    active.ghost?.remove();
    document.body.classList.remove('card-dragging');
    slotRef.current = null;
    setDraggingId(null);
    setSlot(null);
    if (commit && landed) onDropRef.current(landed, active.itemId, active.origin);
  };

  const activate = (active: Session) => {
    active.activated = true;
    const ghost = active.card.cloneNode(true) as HTMLElement;
    ghost.classList.add('card-drag-ghost');
    ghost.removeAttribute('data-card-id');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.width = `${active.width}px`;
    document.body.appendChild(ghost);
    active.ghost = ghost;
    active.cells = snapshotCells(rootRef.current, active.itemId, active.origin, active.height);
    document.body.classList.add('card-dragging');
    setSlotHeight(active.height);
    setDraggingId(active.itemId);
    place(active.origin);
  };

  const cardHandlers = (itemId: string, enabled: boolean) => ({
    onPointerDown: enabled
      ? (event: ReactPointerEvent<HTMLElement>) => {
          if (event.button !== 0 || session.current) return;
          if ((event.target as Element).closest(NOT_DRAGGABLE)) return;
          const card = event.currentTarget;
          const rect = card.getBoundingClientRect();
          const cell = card.closest<HTMLElement>('[data-drop-key]');
          const active: Session = {
            itemId,
            card,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            width: rect.width,
            height: rect.height,
            origin: { cellKey: cell?.dataset.dropKey ?? '', index: indexInCell(cell, itemId) },
            activated: false,
            ghost: null,
            cells: null,
            move: (moved) => {
              if (moved.isPrimary === false) return;
              if (!active.activated) {
                const travel = Math.hypot(moved.clientX - active.startX, moved.clientY - active.startY);
                if (travel < DRAG_THRESHOLD_PX) return;
                activate(active);
              }
              if (active.ghost) {
                active.ghost.style.transform = `translate(${moved.clientX - active.offsetX}px, ${moved.clientY - active.offsetY}px) rotate(1.5deg)`;
              }
              const over = (moved.target as Element | null)?.closest?.<HTMLElement>('[data-drop-key]');
              if (!over) {
                place(active.origin);
                return;
              }
              const cellKey = over.dataset.dropKey ?? '';
              place({ cellKey, index: slotIndexAt(active.cells?.get(cellKey) ?? [], moved.clientY) });
            },
            up: (released) => {
              if (released.isPrimary === false) return;
              finish(active, active.activated);
            },
            cancel: () => finish(active, false),
            key: (keyEvent) => {
              if (keyEvent.key === 'Escape') finish(active, false);
            }
          };
          session.current = active;
          window.addEventListener('pointermove', active.move);
          window.addEventListener('pointerup', active.up);
          window.addEventListener('pointercancel', active.cancel);
          window.addEventListener('keydown', active.key);
        }
      : undefined
  });

  return {
    rootRef,
    draggingId,
    slotHeight,
    slotFor: (cellKey) => (slot?.cellKey === cellKey ? slot.index : null),
    cardHandlers
  };
}

/** The cards of a list with the dragged card left out and the drop slot placed at `slotIndex`. */
export function cardRows<T extends { id: string }>(
  items: T[],
  draggingId: string | null,
  slotIndex: number | null,
  slotHeight: number,
  render: (item: T) => ReactNode
): ReactNode[] {
  const visible = draggingId ? items.filter((item) => item.id !== draggingId) : items;
  const rows: ReactNode[] = [];
  const slotRow = (
    <div key="drop-slot" className="card-drop-slot" style={{ height: slotHeight }} aria-hidden="true" />
  );
  visible.forEach((item, index) => {
    if (slotIndex === index) rows.push(slotRow);
    rows.push(render(item));
  });
  if (slotIndex !== null && slotIndex >= visible.length) rows.push(slotRow);
  return rows;
}

/** How many of the cell's cards sit above the pointer, which is where a slot dropped there goes. */
function slotIndexAt(cards: Array<{ mid: number }>, y: number): number {
  return cards.filter((card) => card.mid < y).length;
}

/** Where a card sits among the cards of its cell, counting only the cards above it. */
function indexInCell(cell: HTMLElement | null, itemId: string): number {
  if (!cell) return 0;
  const ids = [...cell.querySelectorAll<HTMLElement>('[data-card-id]')].map((card) => card.dataset.cardId);
  return Math.max(0, ids.indexOf(itemId));
}

/**
 * The cards of every drop cell with their midpoints, measured once when the drag starts. The origin cell is
 * measured as if the dragged card were already gone, so the slot index does not depend on its own slide.
 */
function snapshotCells(
  root: HTMLElement | null,
  itemId: string,
  origin: DropSlot,
  height: number
): Map<string, Array<{ id: string; mid: number }>> {
  const cells = new Map<string, Array<{ id: string; mid: number }>>();
  if (!root) return cells;
  for (const cell of root.querySelectorAll<HTMLElement>('[data-drop-key]')) {
    const key = cell.dataset.dropKey ?? '';
    const cards = [...cell.querySelectorAll<HTMLElement>('[data-card-id]')];
    const dragged = cards.find((card) => card.dataset.cardId === itemId);
    const draggedTop = dragged?.getBoundingClientRect().top ?? 0;
    // The distance from the dragged card to the card after it, which is the step the cards below move up by.
    const after = dragged ? cards[cards.indexOf(dragged) + 1] : undefined;
    const step = after ? after.getBoundingClientRect().top - draggedTop : height;
    const passed = dragged !== undefined && key === origin.cellKey;
    const list: Array<{ id: string; mid: number }> = [];
    let beyondDragged = false;
    for (const card of cards) {
      if (card.dataset.cardId === itemId) {
        beyondDragged = true;
        continue;
      }
      const rect = card.getBoundingClientRect();
      const shift = passed && beyondDragged ? step : 0;
      list.push({ id: card.dataset.cardId ?? '', mid: rect.top + rect.height / 2 - shift });
    }
    cells.set(key, list);
  }
  return cells;
}
