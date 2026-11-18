/**
 * Three-way line merge, the same idea as `git merge-file`: each side's edits are compared with the merge base, edits
 * that do not touch the same lines combine cleanly, and anything that does becomes a conflict block with markers.
 */

export interface MergeLabels {
  /** Shown after `<<<<<<<`, for the pull request's own branch. */
  head: string;
  /** Shown after `>>>>>>>`, for the base branch. */
  base: string;
}

export interface MergeResult {
  text: string;
  /** Number of conflict blocks left in `text`. Zero means the merge is clean. */
  conflicts: number;
}

/**
 * Bounds the memory of the diff's search trace. Two files that differ in a few places use a sliver of this; a file
 * rewritten from top to bottom would exceed it, and then the whole differing region is treated as one change. That is
 * still a correct merge. It only leaves a larger block for the reader to resolve.
 */
const MAX_TRACE_CELLS = 8_000_000;

interface Hunk {
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

interface Group {
  start: number;
  end: number;
}

const MARKER = /^(<{7}|={7}|>{7})( |$)/;

function splitLines(text: string): string[] {
  return text.split('\n');
}

/** The line at `index`. Callers only ask for indexes inside the array. */
function line(lines: string[], index: number): string {
  return lines[index] ?? '';
}

/** The value at `index`. Callers only ask for indexes inside the array. */
function at(values: Int32Array, index: number): number {
  return values[index] ?? 0;
}

function pushAll(out: string[], lines: string[]): void {
  for (const line of lines) out.push(line);
}

function sameLines(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((line, index) => line === right[index]);
}

/**
 * Pairs of matching lines between `a` and `b`, in order, found by Myers' O(ND) search: its cost follows how many lines
 * differ, not how long the files are. Null when the search would need more trace memory than allowed.
 */
function matchingLines(a: string[], b: string[]): Array<[number, number]> | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  // v[offset + k] is the furthest x reached on diagonal k (x - y = k) after d edits.
  const v = new Int32Array(2 * max + 3);
  // trace[d] holds the diagonals -d..d as they stood before step d, which backtracking needs.
  const trace: Int32Array[] = [];
  let cells = 0;
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    cells += 2 * d + 1;
    if (cells > MAX_TRACE_CELLS) return null;
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && at(v, offset + k - 1) < at(v, offset + k + 1));
      let x = down ? at(v, offset + k + 1) : at(v, offset + k - 1) + 1;
      let y = x - k;
      while (x < n && y < m && line(a, x) === line(b, y)) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;

  const matches: Array<[number, number]> = [];
  let x = n;
  let y = m;
  for (let d = found; d >= 0; d--) {
    const before = trace[d];
    if (!before) break;
    // Diagonal k of the current point, read from the snapshot before step d (index k + d).
    const k = x - y;
    const down = k === -d || (k !== d && at(before, k - 1 + d) < at(before, k + 1 + d));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(before, prevK + d);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      matches.push([x, y]);
    }
    x = prevX;
    y = prevY;
  }
  return matches.reverse();
}

/**
 * Lines that changed between `a` and `b`, as ranges. Where the comparison is too large to trace, the whole differing
 * region is one range, which keeps the merge correct at the cost of a larger conflict.
 */
function diffHunks(a: string[], b: string[]): Hunk[] {
  const matches = matchingLines(a, b) ?? [];
  const hunks: Hunk[] = [];
  let prevA = 0;
  let prevB = 0;
  const stops: Array<[number, number]> = [...matches, [a.length, b.length]];
  for (const [aIndex, bIndex] of stops) {
    if (aIndex > prevA || bIndex > prevB) {
      hunks.push({ aStart: prevA, aEnd: aIndex, bStart: prevB, bEnd: bIndex });
    }
    prevA = aIndex + 1;
    prevB = bIndex + 1;
  }
  return hunks;
}

/** How many lines a side added or removed before ancestor position `pos`. */
function lineShift(hunks: Hunk[], pos: number, strict: boolean): number {
  let shift = 0;
  for (const hunk of hunks) {
    const before = strict ? hunk.aEnd < pos : hunk.aEnd <= pos;
    if (before) shift += hunk.bEnd - hunk.bStart - (hunk.aEnd - hunk.aStart);
  }
  return shift;
}

function sideSpan(hunks: Hunk[], start: number, end: number): [number, number] {
  return [start + lineShift(hunks, start, true), end + lineShift(hunks, end, false)];
}

/** Merges two edits of `ancestor` into one text. Conflicting regions keep both sides between markers. */
export function mergeThreeWay(
  ancestor: string,
  head: string,
  base: string,
  labels: MergeLabels
): MergeResult {
  const anc = splitLines(ancestor);
  const headLines = splitLines(head);
  const baseLines = splitLines(base);
  const headHunks = diffHunks(anc, headLines);
  const baseHunks = diffHunks(anc, baseLines);

  const changes = [...headHunks, ...baseHunks].sort((x, y) => x.aStart - y.aStart || x.aEnd - y.aEnd);
  // Edits that overlap or touch one another become one region, the unit a conflict is judged on.
  const groups: Group[] = [];
  for (const hunk of changes) {
    const last = groups[groups.length - 1];
    if (last && hunk.aStart <= last.end) {
      last.end = Math.max(last.end, hunk.aEnd);
    } else {
      groups.push({ start: hunk.aStart, end: hunk.aEnd });
    }
  }

  const out: string[] = [];
  let conflicts = 0;
  let cursor = 0;
  for (const group of groups) {
    pushAll(out, anc.slice(cursor, group.start));
    const ancestorPart = anc.slice(group.start, group.end);
    const [hs, he] = sideSpan(headHunks, group.start, group.end);
    const [bs, be] = sideSpan(baseHunks, group.start, group.end);
    const headPart = headLines.slice(hs, he);
    const basePart = baseLines.slice(bs, be);
    if (sameLines(headPart, basePart)) {
      pushAll(out, headPart);
    } else if (sameLines(headPart, ancestorPart)) {
      pushAll(out, basePart);
    } else if (sameLines(basePart, ancestorPart)) {
      pushAll(out, headPart);
    } else {
      conflicts++;
      out.push(`<<<<<<< ${labels.head}`);
      pushAll(out, headPart);
      out.push('=======');
      pushAll(out, basePart);
      out.push(`>>>>>>> ${labels.base}`);
    }
    cursor = group.end;
  }
  pushAll(out, anc.slice(cursor));
  return { text: out.join('\n'), conflicts };
}

/** True while the text still holds conflict markers, so it is not ready to commit. */
export function hasConflictMarkers(text: string): boolean {
  return splitLines(text).some((line) => MARKER.test(line));
}

export interface ConflictBlock {
  /** Index of the block's first line (its `<<<<<<<` marker). */
  start: number;
  /** Index after its last line (the line after `>>>>>>>`). */
  end: number;
  head: string[];
  base: string[];
}

/** Conflict blocks in the order they appear. Malformed markers are skipped, not guessed at. */
export function conflictBlocks(text: string): ConflictBlock[] {
  const lines = splitLines(text);
  const blocks: ConflictBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!line(lines, index).startsWith('<<<<<<< ')) {
      index++;
      continue;
    }
    const start = index;
    const separator = lines.indexOf('=======', start + 1);
    if (separator === -1) break;
    const close = lines.findIndex((line, at) => at > separator && line.startsWith('>>>>>>> '));
    if (close === -1) break;
    blocks.push({
      start,
      end: close + 1,
      head: lines.slice(start + 1, separator),
      base: lines.slice(separator + 1, close)
    });
    index = close + 1;
  }
  return blocks;
}

export type BlockChoice = 'head' | 'base' | 'both';

/** Replaces one conflict block with the chosen side, or both sides in order. */
export function resolveBlock(text: string, blockIndex: number, choice: BlockChoice): string {
  const block = conflictBlocks(text)[blockIndex];
  if (!block) return text;
  const lines = splitLines(text);
  const chosen =
    choice === 'head' ? block.head : choice === 'base' ? block.base : [...block.head, ...block.base];
  return [...lines.slice(0, block.start), ...chosen, ...lines.slice(block.end)].join('\n');
}

/** Line index of each conflict block's `<<<<<<<` marker, in order. */
export function conflictStartLines(text: string): number[] {
  return conflictBlocks(text).map((block) => block.start);
}

/**
 * The block to jump to from `cursorLine`: the next one after it, or the previous one before it. Wraps around at the
 * ends. Null when there are no blocks.
 */
export function nearestConflict(
  starts: number[],
  cursorLine: number,
  direction: 'next' | 'previous'
): number | null {
  if (starts.length === 0) return null;
  if (direction === 'next') {
    return starts.find((start) => start > cursorLine) ?? starts[0] ?? null;
  }
  const before = starts.filter((start) => start < cursorLine);
  return before[before.length - 1] ?? starts[starts.length - 1] ?? null;
}
