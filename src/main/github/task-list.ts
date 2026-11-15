import { parser, GFM } from '@lezer/markdown';

/**
 * Task-list checkboxes in an issue's Markdown source. Tasks are found with the same GFM rules that decide
 * which list items render a checkbox, so code blocks and other non-task text are never counted. Only the
 * checkbox character of one task changes, so every other byte of the body is preserved.
 */

const gfm = parser.configure(GFM);

/** Offsets of the `[ ]`, `[x]`, or `[X]` marker of each task item, in document order. */
function taskMarkerStarts(source: string): number[] {
  const starts: number[] = [];
  gfm.parse(source).iterate({
    enter(node) {
      if (node.name === 'TaskMarker') starts.push(node.from);
    }
  });
  return starts;
}

/** How many task items the source contains. The rendered checkboxes follow the same order. */
export function countTaskItems(source: string): number {
  return taskMarkerStarts(source).length;
}

/**
 * Sets the checkbox of the `index`th task item (0-based, document order) to `checked`.
 * Throws when there is no such item, so a stale index can never edit a different line.
 */
export function setTaskItemChecked(source: string, index: number, checked: boolean): string {
  const start = taskMarkerStarts(source)[index];
  if (start === undefined) throw new Error(`There is no task item ${index} in this text.`);
  // The marker is `[`, the box character, then `]`.
  return `${source.slice(0, start + 1)}${checked ? 'x' : ' '}${source.slice(start + 2)}`;
}
