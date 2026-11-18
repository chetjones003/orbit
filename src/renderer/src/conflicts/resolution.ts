import type { ConflictPath, ConflictSet, ResolvedFile } from '../../../shared/conflicts';
import { hasConflictMarkers, mergeThreeWay } from './merge3';

/**
 * conflict: both branches changed the file and the lines overlap; the editor must resolve the marked blocks.
 * merged: both branches changed the file, but not the same lines; Orbit merged it, and it can be checked in the editor.
 * blocked: Orbit cannot edit the text (binary, very large, submodule, deleted on one side and edited on the other).
 *   The reader keeps one side's whole file instead.
 */
export type FileState = 'conflict' | 'merged' | 'blocked';

/** Which side's whole file a blocked file keeps. */
export type SideChoice = 'head' | 'base';

export interface ResolverFile {
  path: string;
  state: FileState;
  /** Why the file is blocked, in words for the reader. Null for the other states. */
  reason: string | null;
  /** The text the editor starts with: the merge with markers, or empty when blocked. */
  initial: string;
  /** The head's text. A file whose final text equals this is left out of the commit. */
  head: string | null;
  /** The file mode written into the commit. */
  mode: string;
  /** Blob ids and modes of each side, so a blocked file can keep one side as it is. Null means absent on that side. */
  headBlob: string | null;
  headMode: string | null;
  baseBlob: string | null;
  baseMode: string | null;
}

export interface Resolution {
  /** Files that need a look, in path order. */
  files: ResolverFile[];
  /** Files only the base branch changed. They need no edits and are copied into the commit as they are. */
  baseOnly: ResolvedFile[];
}

export interface ResolutionLabels {
  head: string;
  base: string;
}

/** The side each blocked file keeps, by path. A blocked file cannot be committed until it has one. */
export type SideChoices = Record<string, SideChoice>;

const DEFAULT_MODE = '100644';

/** Splits a conflict set into the files the reader resolves and the base-branch changes Orbit copies as they are. */
export function planResolution(set: ConflictSet): Resolution {
  const labels: ResolutionLabels = { head: set.headRef, base: set.baseRef };
  const files: ResolverFile[] = [];
  const baseOnly: ResolvedFile[] = [];
  for (const path of [...set.paths].sort((x, y) => x.path.localeCompare(y.path))) {
    const planned = planPath(path, labels);
    if (planned.kind === 'file') files.push(planned.file);
    else if (planned.kind === 'base') baseOnly.push(planned.change);
  }
  return { files, baseOnly };
}

type Planned =
  { kind: 'file'; file: ResolverFile } | { kind: 'base'; change: ResolvedFile } | { kind: 'none' };

/** The fields every resolver file carries, filled from the path's sides. */
function sides(path: ConflictPath): Omit<ResolverFile, 'state' | 'reason' | 'initial' | 'head' | 'mode'> {
  return {
    path: path.path,
    headBlob: path.headBlob,
    headMode: path.headMode,
    baseBlob: path.baseBlob,
    baseMode: path.baseMode
  };
}

function blocked(path: ConflictPath, reason: string): Planned {
  const head = path.texts?.head ?? null;
  return {
    kind: 'file',
    file: {
      ...sides(path),
      state: 'blocked',
      reason,
      initial: '',
      head,
      mode: path.headMode ?? path.baseMode ?? DEFAULT_MODE
    }
  };
}

function planPath(path: ConflictPath, labels: ResolutionLabels): Planned {
  if (!path.changedOnHead) {
    // Only the base branch changed this path. Its blob is copied into the commit as it is, text or not.
    return {
      kind: 'base',
      change: { kind: 'blob', path: path.path, sha: path.baseBlob, mode: path.baseMode ?? DEFAULT_MODE }
    };
  }
  // Both sides changed it to the same thing: nothing to merge.
  if (path.headBlob === path.baseBlob && path.headMode === path.baseMode) return { kind: 'none' };
  if (path.unsupported) return blocked(path, path.unsupported);
  const texts = path.texts;
  if (!texts) return blocked(path, 'Orbit could not read both versions of this file.');
  if (texts.head === null || texts.base === null) {
    return blocked(path, 'One branch deleted this file and the other changed it.');
  }
  const merged = mergeThreeWay(texts.ancestor ?? '', texts.head, texts.base, labels);
  return {
    kind: 'file',
    file: {
      ...sides(path),
      state: merged.conflicts > 0 ? 'conflict' : 'merged',
      reason: null,
      initial: merged.text,
      head: texts.head,
      mode: path.headMode ?? path.baseMode ?? DEFAULT_MODE
    }
  };
}

/**
 * True when every file has a result: no conflict markers remain in edited text, and each blocked file has a side
 * chosen. Nothing is committed on a guess.
 */
export function canCommit(
  files: ResolverFile[],
  texts: Record<string, string>,
  choices: SideChoices
): boolean {
  return files.every((file) => {
    if (file.state === 'blocked') return choices[file.path] !== undefined;
    return !hasConflictMarkers(texts[file.path] ?? file.initial);
  });
}

/**
 * The changes for the resolving commit: edited or merged text that differs from the head, the whole side each blocked
 * file keeps, and the base-branch changes.
 */
export function commitFiles(
  resolution: Resolution,
  texts: Record<string, string>,
  choices: SideChoices
): ResolvedFile[] {
  const written: ResolvedFile[] = [];
  for (const file of resolution.files) {
    if (file.state === 'blocked') {
      const choice = choices[file.path];
      if (choice === undefined) continue;
      const blob = choice === 'head' ? file.headBlob : file.baseBlob;
      const mode = (choice === 'head' ? file.headMode : file.baseMode) ?? DEFAULT_MODE;
      written.push({ kind: 'blob', path: file.path, sha: blob, mode });
      continue;
    }
    const content = texts[file.path] ?? file.initial;
    if (content !== file.head) written.push({ kind: 'text', path: file.path, content, mode: file.mode });
  }
  for (const change of resolution.baseOnly) written.push(change);
  return written;
}
