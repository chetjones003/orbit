import type { KeyboardEvent } from 'react';

/**
 * Arrow-key movement between the rows of a list (the `.issue-row` buttons inside `container`). Down and Up move
 * between rows, and Up from the first row returns focus to `above` when one is given. Other keys are left alone.
 */
export function moveRowFocus(
  event: KeyboardEvent<HTMLElement>,
  container: HTMLElement | null,
  above?: HTMLElement | null
): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  if (!container) return;
  const rows = [...container.querySelectorAll<HTMLButtonElement>('.issue-row')];
  const index = rows.indexOf(document.activeElement as HTMLButtonElement);
  if (index === -1) return;
  event.preventDefault();
  if (event.key === 'ArrowDown') rows[Math.min(index + 1, rows.length - 1)]?.focus();
  else if (index === 0 && above) above.focus();
  else rows[Math.max(index - 1, 0)]?.focus();
}
