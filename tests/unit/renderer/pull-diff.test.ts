import { describe, expect, it } from 'vitest';
import { isDelete, isInsert } from 'react-diff-view';
import type { PullFile } from '../../../src/shared/issues';
import { fileNote, isLargePatch, parseFileDiff } from '../../../src/renderer/src/issues/pull-diff';

function file(overrides: Partial<PullFile> = {}): PullFile {
  return {
    filename: 'src/a.ts',
    previousFilename: null,
    status: 'modified',
    additions: 1,
    deletions: 1,
    patch: '@@ -1,2 +1,2 @@\n-old\n+new\n same',
    noPatchReason: null,
    ...overrides
  };
}

describe('parseFileDiff', () => {
  it('parses a GitHub per-file patch into hunks with delete, insert, and normal lines', () => {
    const parsed = parseFileDiff(file());

    expect(parsed).not.toBeNull();
    expect(parsed!.hunks).toHaveLength(1);
    const changes = parsed!.hunks[0].changes;
    expect(changes.map((change) => [isDelete(change), isInsert(change)])).toEqual([
      [true, false],
      [false, true],
      [false, false]
    ]);
  });

  it('returns null when GitHub gave no patch, so nothing is parsed', () => {
    expect(parseFileDiff(file({ patch: null, noPatchReason: 'too-large' }))).toBeNull();
  });
});

describe('fileNote', () => {
  it('names a rename and its previous path', () => {
    expect(fileNote(file({ status: 'renamed', previousFilename: 'src/old.ts' }))).toBe(
      'Renamed from src/old.ts'
    );
  });

  it('labels new and deleted files', () => {
    expect(fileNote(file({ status: 'added' }))).toBe('New file');
    expect(fileNote(file({ status: 'removed' }))).toBe('Deleted file');
  });

  it('says a binary file has no text diff, and a rename with no content change says so', () => {
    expect(fileNote(file({ patch: null, noPatchReason: 'binary', additions: 0, deletions: 0 }))).toBe(
      'No text diff to show: a binary file or a mode-only change.'
    );
    expect(
      fileNote(file({ status: 'renamed', previousFilename: 'a.png', patch: null, noPatchReason: 'binary' }))
    ).toBe('Renamed without content changes.');
  });

  it('sends the reader to GitHub for a diff too large to return', () => {
    expect(fileNote(file({ patch: null, noPatchReason: 'too-large' }))).toBe(
      'This diff is too large to show here. View it on GitHub.'
    );
  });
});

describe('isLargePatch', () => {
  it('treats a patch over 400 lines as large, so it loads only when asked', () => {
    const small = Array.from({ length: 400 }, (_, i) => `+line ${i}`).join('\n');
    const large = Array.from({ length: 401 }, (_, i) => `+line ${i}`).join('\n');
    expect(isLargePatch(small)).toBe(false);
    expect(isLargePatch(large)).toBe(true);
  });
});
