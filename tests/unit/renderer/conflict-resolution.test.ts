import { describe, expect, it } from 'vitest';
import type { ConflictPath, ConflictSet } from '../../../src/shared/conflicts';
import { canCommit, commitFiles, planResolution } from '../../../src/renderer/src/conflicts/resolution';

/** A path the base changed. Blob ids stand in for content; texts are given only when both sides changed. */
const path = (overrides: Partial<ConflictPath> & { path: string }): ConflictPath => ({
  changedOnHead: false,
  changedOnBase: true,
  unsupported: null,
  ancestorBlob: 'anc',
  headBlob: 'anc',
  headMode: '100644',
  baseBlob: 'base',
  baseMode: '100644',
  texts: null,
  ...overrides
});

const set = (paths: ConflictPath[]): ConflictSet => ({
  headRef: 'feature',
  headSha: 'h1',
  headInRepo: true,
  baseRef: 'main',
  baseSha: 'b1',
  mergeBaseSha: 'm1',
  paths
});

const bothChanged = (overrides: Partial<ConflictPath> & { path: string }): ConflictPath =>
  path({
    changedOnHead: true,
    headBlob: 'head',
    texts: { ancestor: 'a\nb\nc', head: 'a\nhead\nc', base: 'a\nbase\nc' },
    ...overrides
  });

describe('planResolution', () => {
  it('copies base-branch-only changes by blob, without asking for an edit', () => {
    const plan = planResolution(set([path({ path: 'docs/readme.md', baseBlob: 'new' })]));
    expect(plan.files).toEqual([]);
    expect(plan.baseOnly).toEqual([{ kind: 'blob', path: 'docs/readme.md', sha: 'new', mode: '100644' }]);
  });

  it('carries a base-branch deletion as a null sha', () => {
    const plan = planResolution(set([path({ path: 'old.txt', baseBlob: null, baseMode: null })]));
    expect(plan.baseOnly).toEqual([{ kind: 'blob', path: 'old.txt', sha: null, mode: '100644' }]);
  });

  it('copies a base-only binary without reading it', () => {
    const plan = planResolution(set([path({ path: 'logo.png', baseBlob: 'png' })]));
    expect(plan.files).toEqual([]);
    expect(plan.baseOnly).toEqual([{ kind: 'blob', path: 'logo.png', sha: 'png', mode: '100644' }]);
  });

  it('marks overlapping edits as a conflict with markers to resolve', () => {
    const plan = planResolution(set([bothChanged({ path: 'src/a.cpp' })]));
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0]).toMatchObject({ path: 'src/a.cpp', state: 'conflict', reason: null });
    expect(plan.files[0]?.initial).toBe('a\n<<<<<<< feature\nhead\n=======\nbase\n>>>>>>> main\nc');
  });

  it('merges edits to different lines without asking for anything', () => {
    const plan = planResolution(
      set([
        bothChanged({
          path: 'src/b.cpp',
          texts: { ancestor: 'a\nb\nc', head: 'A\nb\nc', base: 'a\nb\nC' }
        })
      ])
    );
    expect(plan.files[0]).toMatchObject({ state: 'merged', initial: 'A\nb\nC' });
  });

  it('leaves out a file both sides changed the same way', () => {
    const plan = planResolution(set([bothChanged({ path: 'same.txt', headBlob: 'x', baseBlob: 'x' })]));
    expect(plan.files).toEqual([]);
    expect(plan.baseOnly).toEqual([]);
  });

  it('blocks a file one side deleted and the other edited', () => {
    const plan = planResolution(
      set([
        bothChanged({
          path: 'gone.txt',
          headBlob: 'changed',
          baseBlob: null,
          texts: { ancestor: 'x', head: 'changed', base: null }
        })
      ])
    );
    expect(plan.files[0]).toMatchObject({ state: 'blocked' });
    expect(plan.files[0]?.reason).toContain('deleted');
  });

  it('blocks a path Orbit cannot read as text, and says why', () => {
    const plan = planResolution(
      set([
        bothChanged({
          path: 'data.bin',
          unsupported: 'Orbit cannot merge this file: it is a binary file.',
          texts: null
        })
      ])
    );
    expect(plan.files[0]).toMatchObject({ state: 'blocked' });
    expect(plan.files[0]?.reason).toContain('binary');
  });
});

describe('canCommit and commitFiles', () => {
  const plan = planResolution(
    set([bothChanged({ path: 'src/a.cpp' }), path({ path: 'docs/readme.md', baseBlob: 'new' })])
  );
  const conflicted = plan.files[0]?.initial ?? '';

  it('refuses to commit while markers remain', () => {
    expect(canCommit(plan.files, { 'src/a.cpp': conflicted }, {})).toBe(false);
  });

  it('commits the resolved text and the base-only blob once markers are gone', () => {
    const texts = { 'src/a.cpp': 'a\nkept by hand\nc' };
    expect(canCommit(plan.files, texts, {})).toBe(true);
    expect(commitFiles(plan, texts, {})).toEqual([
      { kind: 'text', path: 'src/a.cpp', content: 'a\nkept by hand\nc', mode: '100644' },
      { kind: 'blob', path: 'docs/readme.md', sha: 'new', mode: '100644' }
    ]);
  });

  it('never commits while a file is blocked', () => {
    const blockedPlan = planResolution(
      set([
        bothChanged({
          path: 'data.bin',
          unsupported: 'Orbit cannot merge this file: it is a binary file.',
          texts: null
        })
      ])
    );
    expect(canCommit(blockedPlan.files, {}, {})).toBe(false);
  });

  it('keeps a merged file in the commit only if it differs from the head, and keeps its mode', () => {
    const mergedPlan = planResolution(
      set([
        bothChanged({
          path: 'src/b.cpp',
          headMode: '100755',
          texts: { ancestor: 'a\nb\nc', head: 'A\nb\nc', base: 'a\nb\nC' }
        })
      ])
    );
    expect(commitFiles(mergedPlan, {}, {})).toEqual([
      { kind: 'text', path: 'src/b.cpp', content: 'A\nb\nC', mode: '100755' }
    ]);
  });
});

describe('blocked files keep one whole side', () => {
  const binary = planResolution(
    set([
      bothChanged({
        path: 'logo.png',
        headBlob: 'png-head',
        baseBlob: 'png-base',
        unsupported: 'Orbit cannot merge this file: it is a binary file.',
        texts: null
      }),
      bothChanged({
        path: 'gone.txt',
        headBlob: 'edited',
        baseBlob: null,
        baseMode: null,
        texts: { ancestor: 'x', head: 'edited', base: null }
      })
    ])
  );

  it('needs a side chosen for each blocked file before it can commit', () => {
    expect(canCommit(binary.files, {}, {})).toBe(false);
    expect(canCommit(binary.files, {}, { 'logo.png': 'head' })).toBe(false);
    expect(canCommit(binary.files, {}, { 'logo.png': 'head', 'gone.txt': 'base' })).toBe(true);
  });

  it('writes the chosen side as it is, and a side that is absent deletes the file', () => {
    expect(commitFiles(binary, {}, { 'logo.png': 'base', 'gone.txt': 'base' })).toEqual([
      { kind: 'blob', path: 'gone.txt', sha: null, mode: '100644' },
      { kind: 'blob', path: 'logo.png', sha: 'png-base', mode: '100644' }
    ]);
    expect(commitFiles(binary, {}, { 'logo.png': 'head', 'gone.txt': 'head' })).toEqual([
      { kind: 'blob', path: 'gone.txt', sha: 'edited', mode: '100644' },
      { kind: 'blob', path: 'logo.png', sha: 'png-head', mode: '100644' }
    ]);
  });
});
