import { conflictBlocks } from './merge3';

/** Unchanged lines kept visible on each side of a conflict block. */
export const CONTEXT_LINES = 8;
/** Shorter stretches of unchanged text stay visible, since folding them saves little. */
export const MIN_FOLDED_LINES = 6;

/**
 * Stretches of unchanged text far from every conflict block, as [anchor, last] line indexes (0-based). The anchor line
 * stays visible, and the lines after it up to `last` fold away. Only the text near conflicts is shown in the editor.
 */
export function foldableStretches(text: string, context = CONTEXT_LINES): Array<[number, number]> {
  const lines = text.split('\n');
  const near = new Uint8Array(lines.length);
  for (const block of conflictBlocks(text)) {
    const from = Math.max(0, block.start - context);
    const to = Math.min(lines.length - 1, block.end - 1 + context);
    near.fill(1, from, to + 1);
  }
  const stretches: Array<[number, number]> = [];
  let index = 0;
  while (index < lines.length) {
    if (near[index]) {
      index++;
      continue;
    }
    const start = index;
    while (index < lines.length && !near[index]) index++;
    const last = index - 1;
    if (last - start >= MIN_FOLDED_LINES) stretches.push([start, last]);
  }
  return stretches;
}
