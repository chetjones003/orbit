import { describe, expect, it } from 'vitest';
import {
  conflictBlocks,
  conflictStartLines,
  nearestConflict,
  hasConflictMarkers,
  mergeThreeWay,
  resolveBlock
} from '../../../src/renderer/src/conflicts/merge3';
import { foldableStretches } from '../../../src/renderer/src/conflicts/context';

const labels = { head: 'feature', base: 'main' };
const merge = (ancestor: string, head: string, base: string) => {
  const result = mergeThreeWay(ancestor, head, base, labels);
  if (!result) throw new Error('merge refused');
  return result;
};

describe('mergeThreeWay', () => {
  it('combines edits to different lines without a conflict', () => {
    const ancestor = 'one\ntwo\nthree\nfour\nfive\n';
    const head = 'one\nTWO\nthree\nfour\nfive\n';
    const base = 'one\ntwo\nthree\nfour\nFIVE\n';
    expect(merge(ancestor, head, base)).toEqual({
      text: 'one\nTWO\nthree\nfour\nFIVE\n',
      conflicts: 0
    });
  });

  it('takes the only side that changed', () => {
    const ancestor = 'a\nb\nc';
    expect(merge(ancestor, 'a\nB\nc', ancestor)).toEqual({ text: 'a\nB\nc', conflicts: 0 });
    expect(merge(ancestor, ancestor, 'a\nb\nC')).toEqual({ text: 'a\nb\nC', conflicts: 0 });
  });

  it('accepts identical edits from both sides', () => {
    const ancestor = 'a\nb\nc';
    expect(merge(ancestor, 'a\nX\nc', 'a\nX\nc')).toEqual({ text: 'a\nX\nc', conflicts: 0 });
  });

  it('marks overlapping edits as a conflict and keeps both sides', () => {
    const ancestor = 'a\nold\nc';
    const head = 'a\nhead version\nc';
    const base = 'a\nbase version\nc';
    const result = merge(ancestor, head, base);
    expect(result.conflicts).toBe(1);
    expect(result.text).toBe('a\n<<<<<<< feature\nhead version\n=======\nbase version\n>>>>>>> main\nc');
  });

  it('treats edits on touching lines as a conflict, as git does', () => {
    const ancestor = 'a\nb\nc\nd';
    const head = 'a\nB\nc\nd';
    const base = 'a\nb\nC\nd';
    expect(merge(ancestor, head, base).conflicts).toBe(1);
  });

  it('conflicts when both sides insert at the same place', () => {
    const ancestor = 'a\nc';
    const result = merge(ancestor, 'a\nfrom head\nc', 'a\nfrom base\nc');
    expect(result.conflicts).toBe(1);
    expect(result.text).toContain('from head');
    expect(result.text).toContain('from base');
  });

  it('merges a clean change next to a conflict without losing either', () => {
    const ancestor = 'x\ny\nz\nw\nv';
    const head = 'X\ny\nz\nw\nhv';
    const base = 'x\ny\nZ\nw\nbv';
    const result = merge(ancestor, head, base);
    expect(result.conflicts).toBe(1);
    expect(result.text).toBe('X\ny\nZ\nw\n<<<<<<< feature\nhv\n=======\nbv\n>>>>>>> main');
  });

  it('merges a large file whose two sides edit far-apart lines', () => {
    const ancestor = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n');
    const head = ancestor.replace('line 10', 'HEAD 10');
    const base = ancestor.replace('line 4900', 'BASE 4900');
    const result = merge(ancestor, head, base);
    expect(result.conflicts).toBe(0);
    expect(result.text).toBe(ancestor.replace('line 10', 'HEAD 10').replace('line 4900', 'BASE 4900'));
  });

  it('still merges a large file that is rewritten, as one conflict, without refusing', () => {
    const long = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join('\n');
    const other = Array.from({ length: 3000 }, (_, i) => `other ${i}`).join('\n');
    const result = merge(long, other, long.replace('line 0', 'changed 0'));
    expect(result.conflicts).toBe(1);
    expect(result.text).toContain('<<<<<<< feature');
  });
});

describe('conflict markers', () => {
  const text =
    'top\n<<<<<<< feature\nhead one\n=======\nbase one\n>>>>>>> main\nmiddle\n<<<<<<< feature\nh2\n=======\nb2\n>>>>>>> main\nbottom';

  it('detects leftover markers', () => {
    expect(hasConflictMarkers(text)).toBe(true);
    expect(hasConflictMarkers('plain\ntext')).toBe(false);
  });

  it('lists the blocks in order', () => {
    const blocks = conflictBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ head: ['head one'], base: ['base one'] });
    expect(blocks[1]).toMatchObject({ head: ['h2'], base: ['b2'] });
  });

  it('resolves one block to the head, the base, or both', () => {
    expect(resolveBlock(text, 0, 'head')).toBe(
      'top\nhead one\nmiddle\n<<<<<<< feature\nh2\n=======\nb2\n>>>>>>> main\nbottom'
    );
    expect(resolveBlock(text, 0, 'base')).toBe(
      'top\nbase one\nmiddle\n<<<<<<< feature\nh2\n=======\nb2\n>>>>>>> main\nbottom'
    );
    expect(resolveBlock(text, 0, 'both')).toContain('top\nhead one\nbase one\nmiddle');
  });

  it('clears the markers once every block is resolved', () => {
    const once = resolveBlock(text, 0, 'head');
    const done = resolveBlock(once, 0, 'base');
    expect(hasConflictMarkers(done)).toBe(false);
    expect(done).toBe('top\nhead one\nmiddle\nb2\nbottom');
  });
});

describe('conflict navigation', () => {
  const text = 'a\n<<<<<<< h\nx\n=======\ny\n>>>>>>> b\nmid\n<<<<<<< h\nz\n=======\nw\n>>>>>>> b\nend';
  const starts = conflictStartLines(text);

  it('finds each block start line', () => {
    expect(starts).toEqual([1, 7]);
  });

  it('moves to the next block after the cursor, and wraps to the first', () => {
    expect(nearestConflict(starts, 0, 'next')).toBe(1);
    expect(nearestConflict(starts, 1, 'next')).toBe(7);
    expect(nearestConflict(starts, 8, 'next')).toBe(1);
  });

  it('moves to the previous block before the cursor, and wraps to the last', () => {
    expect(nearestConflict(starts, 8, 'previous')).toBe(7);
    expect(nearestConflict(starts, 3, 'previous')).toBe(1);
    expect(nearestConflict(starts, 0, 'previous')).toBe(7);
  });

  it('has nothing to go to without conflicts', () => {
    expect(nearestConflict([], 0, 'next')).toBeNull();
  });
});

describe('folding far-away text', () => {
  const far = Array.from({ length: 40 }, (_, i) => `unchanged ${i}`);
  const text = [...far, '<<<<<<< h', 'x', '=======', 'y', '>>>>>>> b', ...far].join('\n');

  it('folds the stretches away from the conflict, keeping context near it', () => {
    const stretches = foldableStretches(text);
    // The block sits at lines 40-44. Eight lines of context stay on each side.
    expect(stretches).toEqual([
      [0, 31],
      [53, 84]
    ]);
  });

  it('folds nothing when every line is near a conflict', () => {
    expect(foldableStretches('<<<<<<< h\nx\n=======\ny\n>>>>>>> b')).toEqual([]);
  });
});
