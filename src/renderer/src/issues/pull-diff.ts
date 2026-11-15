import {
  isDelete,
  isInsert,
  isNormal,
  parseDiff,
  type ChangeData,
  type FileData,
  type HunkData
} from 'react-diff-view';
import type { PullFile, ReviewAnchor } from '../../../shared/issues';

/** Patches longer than this many lines are not parsed until the reader asks for them. */
export const LARGE_PATCH_LINES = 400;

export function isLargePatch(patch: string): boolean {
  return patch.split('\n').length > LARGE_PATCH_LINES;
}

/**
 * Parses one file's patch. GitHub's per-file patch has no `diff --git` or `---`/`+++` header, so
 * a minimal header is added for the parser. Returns null when there is no patch to parse.
 */
export function parseFileDiff(file: PullFile): FileData | null {
  if (file.patch === null) return null;
  const oldPath = file.previousFilename ?? file.filename;
  const header = `diff --git a/${oldPath} b/${file.filename}\n--- a/${oldPath}\n+++ b/${file.filename}\n`;
  const [parsed] = parseDiff(header + file.patch);
  return parsed ?? null;
}

/** A short line that says what the file is, or why no diff is shown. Null when nothing needs saying. */
export function fileNote(file: PullFile): string | null {
  if (file.noPatchReason === 'too-large') return 'This diff is too large to show here. View it on GitHub.';
  if (file.noPatchReason === 'binary') {
    return file.status === 'renamed' || file.status === 'copied'
      ? 'Renamed without content changes.'
      : 'No text diff to show: a binary file or a mode-only change.';
  }
  if (file.status === 'renamed' || file.status === 'copied') {
    return `Renamed from ${file.previousFilename ?? 'another path'}`;
  }
  if (file.status === 'added') return 'New file';
  if (file.status === 'removed') return 'Deleted file';
  return null;
}

/**
 * The diff line a click on a gutter cell refers to, for a review comment. The old side is used only in
 * split view; a removed line is always on the old side, an added line on the new side.
 */
export function anchorForChange(path: string, change: ChangeData, side?: string): ReviewAnchor | null {
  if (isNormal(change)) {
    return side === 'old'
      ? { path, side: 'LEFT', line: change.oldLineNumber }
      : { path, side: 'RIGHT', line: change.newLineNumber };
  }
  if (isInsert(change)) return { path, side: 'RIGHT', line: change.lineNumber };
  if (isDelete(change)) return { path, side: 'LEFT', line: change.lineNumber };
  return null;
}

/** The change a review anchor sits on, so a comment box can be pinned under it. */
export function findChangeForAnchor(hunks: HunkData[], anchor: ReviewAnchor): ChangeData | null {
  for (const hunk of hunks) {
    for (const change of hunk.changes) {
      if (anchor.side === 'RIGHT') {
        if (isInsert(change) && change.lineNumber === anchor.line) return change;
        if (isNormal(change) && change.newLineNumber === anchor.line) return change;
      } else {
        if (isDelete(change) && change.lineNumber === anchor.line) return change;
        if (isNormal(change) && change.oldLineNumber === anchor.line) return change;
      }
    }
  }
  return null;
}
