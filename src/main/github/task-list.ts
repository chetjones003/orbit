/**
 * Task-list checkboxes in an issue's Markdown source. Only the checkbox character of one
 * source line changes, so every other byte of the body is preserved.
 */

/** A task item: optional quote and list markers, then `[ ]`, `[x]`, or `[X]`. */
const TASK_LINE = /^([ \t>]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])(\])/;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;

/** Source line indexes of task items, in document order. Fenced code is not part of the document's tasks. */
function taskLineIndexes(lines: string[]): number[] {
  const indexes: number[] = [];
  let fence: string | null = null;
  lines.forEach((line, i) => {
    const fenceMatch = FENCE.exec(line);
    if (fence === null && fenceMatch) {
      fence = fenceMatch[1] ?? null;
      return;
    }
    if (fence !== null) {
      if (fenceMatch && fenceMatch[1]?.[0] === fence[0] && (fenceMatch[1]?.length ?? 0) >= fence.length) {
        fence = null;
      }
      return;
    }
    if (TASK_LINE.test(line)) indexes.push(i);
  });
  return indexes;
}

/** How many task items the source contains. The rendered checkboxes follow the same order. */
export function countTaskItems(source: string): number {
  return taskLineIndexes(source.split('\n')).length;
}

/**
 * Sets the checkbox of the `index`th task item (0-based, document order) to `checked`.
 * Throws when there is no such item, so a stale index can never edit a different line.
 */
export function setTaskItemChecked(source: string, index: number, checked: boolean): string {
  const lines = source.split('\n');
  const target = taskLineIndexes(lines)[index];
  if (target === undefined) throw new Error(`There is no task item ${index} in this text.`);
  const line = lines[target] ?? '';
  lines[target] = line.replace(TASK_LINE, (_match, open: string, _box: string, close: string) => {
    return `${open}${checked ? 'x' : ' '}${close}`;
  });
  return lines.join('\n');
}
