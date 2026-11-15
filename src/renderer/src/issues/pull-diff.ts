import { parseDiff, type FileData } from 'react-diff-view';
import type { PullFile } from '../../../shared/issues';

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
      : 'Binary file: no text diff to show.';
  }
  if (file.status === 'renamed' || file.status === 'copied') {
    return `Renamed from ${file.previousFilename ?? 'another path'}`;
  }
  if (file.status === 'added') return 'New file';
  if (file.status === 'removed') return 'Deleted file';
  return null;
}
