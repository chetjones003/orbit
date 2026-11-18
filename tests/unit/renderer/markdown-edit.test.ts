import { describe, expect, it } from 'vitest';
import {
  continueList,
  countCharacters,
  isOverLimit,
  linkAroundSelection,
  pasteEdit,
  prefixLines,
  wrapSelection,
  type TextEdit
} from '../../../src/renderer/src/comments/markdown-edit';

/** Applies an edit the way the editor does, so expectations are written as the final text a user sees. */
function apply(doc: string, edit: TextEdit): string {
  return doc.slice(0, edit.changes.from) + edit.changes.insert + doc.slice(edit.changes.to);
}

describe('wrapSelection (bold, italic, code)', () => {
  it('wraps the selected text and keeps the wrapped text selected', () => {
    const edit = wrapSelection('hello world', 6, 11, '**');

    expect(apply('hello world', edit)).toBe('hello **world**');
    expect(edit.selection).toEqual({ anchor: 8, head: 13 });
  });

  it('inserts an empty marker pair at the cursor and puts the cursor between them', () => {
    const edit = wrapSelection('hello', 5, 5, '`');

    expect(apply('hello', edit)).toBe('hello``');
    expect(edit.selection).toEqual({ anchor: 6, head: 6 });
  });

  it('removes the markers when the selection is already wrapped in them', () => {
    const edit = wrapSelection('hello **world**', 8, 13, '**');

    expect(apply('hello **world**', edit)).toBe('hello world');
    expect(edit.selection).toEqual({ anchor: 6, head: 11 });
  });
});

describe('linkAroundSelection (Ctrl/Cmd+L)', () => {
  it('wraps the selection as a link and puts the cursor in the URL slot', () => {
    const edit = linkAroundSelection('see here', 4, 8);

    expect(apply('see here', edit)).toBe('see [here]()');
    expect(edit.selection).toEqual({ anchor: 11, head: 11 });
  });

  it('inserts an empty link with the cursor in the text when nothing is selected', () => {
    const edit = linkAroundSelection('', 0, 0);

    expect(apply('', edit)).toBe('[]()');
    expect(edit.selection).toEqual({ anchor: 1, head: 1 });
  });
});

describe('pasteEdit', () => {
  it('turns a pasted URL over a selection into a Markdown link', () => {
    const edit = pasteEdit('see here', 4, 8, 'https://example.com/docs');

    expect(apply('see here', edit)).toBe('see [here](https://example.com/docs)');
  });

  it('pastes a URL with no selection verbatim', () => {
    const edit = pasteEdit('see ', 4, 4, 'https://example.com');

    expect(apply('see ', edit)).toBe('see https://example.com');
  });

  it('pastes ordinary text verbatim, keeping indentation and line breaks', () => {
    const code = 'function f() {\n\treturn 1;\n}\n';

    const edit = pasteEdit('', 0, 0, code);

    expect(apply('', edit)).toBe(code);
  });

  it('replaces a selection with non-URL text verbatim', () => {
    const edit = pasteEdit('keep this', 5, 9, '  spaced  ');

    expect(apply('keep this', edit)).toBe('keep   spaced  ');
  });
});

describe('continueList', () => {
  it('continues a bullet list on Enter', () => {
    const doc = '- one';
    const edit = continueList(doc, doc.length);

    expect(edit).not.toBeNull();
    expect(apply(doc, edit!)).toBe('- one\n- ');
  });

  it('keeps indentation and counts ordered items up', () => {
    const doc = '  2. second';
    const edit = continueList(doc, doc.length);

    expect(apply(doc, edit!)).toBe('  2. second\n  3. ');
  });

  it('starts a new unchecked task after a checked one', () => {
    const doc = '- [x] shipped';
    const edit = continueList(doc, doc.length);

    expect(apply(doc, edit!)).toBe('- [x] shipped\n- [ ] ');
  });

  it('ends the list when Enter is pressed on an empty item', () => {
    const doc = '- one\n- ';
    const edit = continueList(doc, doc.length);

    expect(apply(doc, edit!)).toBe('- one\n');
  });

  it('does nothing on a line that is not a list item', () => {
    expect(continueList('plain text', 10)).toBeNull();
  });
});

describe('prefixLines (quote and list toolbar buttons)', () => {
  it('prefixes every selected line', () => {
    const doc = 'first\nsecond';
    const edit = prefixLines(doc, 0, doc.length, '> ');

    expect(apply(doc, edit)).toBe('> first\n> second');
  });

  it('removes the prefix again when every selected line already has it', () => {
    const doc = '> first\n> second';
    const edit = prefixLines(doc, 0, doc.length, '> ');

    expect(apply(doc, edit)).toBe('first\nsecond');
  });
});

describe('character counting', () => {
  it('counts code points, so an emoji is one character', () => {
    expect(countCharacters('a😀')).toBe(2);
  });

  it('is over the limit only above 65,536 characters', () => {
    expect(isOverLimit('x'.repeat(65_536))).toBe(false);
    expect(isOverLimit('x'.repeat(65_537))).toBe(true);
  });
});

describe('pasteEdit line endings', () => {
  it('turns Windows line breaks into the editor line break so the cursor lands after the paste', () => {
    const edit = pasteEdit('abc', 3, 3, 'x\r\ny\r\n');

    expect(apply('abc', edit)).toBe('abcx\ny\n');
    expect(edit.selection).toEqual({ anchor: 7, head: 7 });
  });
});
