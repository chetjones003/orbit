import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

/** jsdom has no PointerEvent, so this keeps the coordinates and ids the card drag reads. */
class PointerEventShim extends MouseEvent {
  readonly pointerId: number;
  readonly isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.isPrimary = init.isPrimary ?? true;
  }
}

if (!('PointerEvent' in window)) {
  Object.defineProperty(window, 'PointerEvent', { value: PointerEventShim, configurable: true });
}

/**
 * Gives each card a 100px step down its cell and 80px height, so the pointer's height picks the slot. Call
 * inside a describe block that drags cards.
 */
export function installDragLayout(): void {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const cell = this.closest<HTMLElement>('[data-drop-key]');
      const cards = cell ? [...cell.querySelectorAll<HTMLElement>('[data-card-id]')] : [];
      const index = cards.indexOf(this);
      const top = index >= 0 ? index * 100 : 0;
      const height = index >= 0 ? 80 : 0;
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        bottom: top + height,
        right: 200,
        width: 200,
        height,
        toJSON: () => ({})
      };
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
}

/** Presses on a card, as a user does to start a drag. */
export function dragCard(card: HTMLElement): void {
  fireEvent.pointerDown(card.closest<HTMLElement>('[data-card-id]') ?? card, {
    button: 0,
    pointerId: 1,
    clientX: 0,
    clientY: 0
  });
}

/**
 * Moves the pointer to `clientY` over `target` and releases it there. The first move also starts the drag,
 * so it must travel past the drag threshold.
 */
export function dropOn(target: HTMLElement, clientY = 10): void {
  fireEvent.pointerMove(target, { pointerId: 1, clientX: 0, clientY });
  fireEvent.pointerUp(target, { pointerId: 1, clientX: 0, clientY });
}
