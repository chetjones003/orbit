import { COMMENT_MAX_CHARS } from '../../../shared/issues';

/**
 * A text change the editor applies in one step. It is plain data, so the editing rules can be tested
 * without a DOM or CodeMirror. Positions are code-unit offsets into the document.
 */
export interface TextEdit {
  changes: { from: number; to: number; insert: string };
  selection: { anchor: number; head: number };
}

const LIST_LINE = /^(\s*)([-*+]|\d+\.)(\s+)(\[[ xX]\]\s+)?(.*)$/;
/** A pasted link must be one absolute http(s) URL with no spaces or brackets that would break Markdown. */
const BARE_URL = /^https?:\/\/[^\s()<>]+$/;

/** Bold, italic, or inline code around the selection. Toggles the markers off when they already wrap it. */
export function wrapSelection(doc: string, from: number, to: number, marker: string): TextEdit {
  const selected = doc.slice(from, to);
  const m = marker.length;
  const wrapped =
    from !== to && from >= m && doc.slice(from - m, from) === marker && doc.slice(to, to + m) === marker;
  if (wrapped) {
    return edit(from - m, to + m, selected, from - m, from - m + selected.length);
  }
  if (from === to) {
    return edit(from, to, marker + marker, from + m, from + m);
  }
  return edit(from, to, marker + selected + marker, from + m, to + m);
}

/**
 * Ctrl/Cmd+K. With text selected, the cursor lands in the URL slot. With nothing selected,
 * the cursor lands in the link text, which the user types first.
 */
export function linkAroundSelection(doc: string, from: number, to: number): TextEdit {
  const selected = doc.slice(from, to);
  const insert = `[${selected}]()`;
  const cursor = selected === '' ? from + 1 : from + selected.length + 3;
  return edit(from, to, insert, cursor, cursor);
}

/**
 * Pasting a bare URL over selected text makes a link. Anything else is inserted exactly as copied,
 * so code indentation and line breaks survive.
 */
export function pasteEdit(doc: string, from: number, to: number, copied: string): TextEdit {
  // Windows clipboards use CRLF; the editor stores LF. Normalise first so the cursor math matches the document.
  const pasted = copied.replace(/\r\n?/g, '\n');
  const selected = doc.slice(from, to);
  const asLink = from !== to && BARE_URL.test(pasted) && !selected.includes('\n');
  const insert = asLink ? `[${selected}](${pasted})` : pasted;
  return edit(from, to, insert, from + insert.length, from + insert.length);
}

/**
 * Enter on a list line starts the next item (same indent, next number, a fresh unchecked task).
 * Enter on an empty item ends the list. Returns null on lines that are not list items.
 */
export function continueList(doc: string, pos: number): TextEdit | null {
  const lineStart = pos === 0 ? 0 : doc.lastIndexOf('\n', pos - 1) + 1;
  const match = LIST_LINE.exec(doc.slice(lineStart, pos));
  if (!match) return null;
  const [, indent = '', marker = '', space = '', task, content = ''] = match;

  if (content === '') {
    return edit(lineStart, pos, '', lineStart, lineStart);
  }
  const next = /^\d+\.$/.test(marker) ? `${Number.parseInt(marker, 10) + 1}.` : marker;
  const insert = `\n${indent}${next}${space}${task ? '[ ] ' : ''}`;
  return edit(pos, pos, insert, pos + insert.length, pos + insert.length);
}

/** Adds `prefix` to every line the selection touches, or removes it when they all have it already. */
export function prefixLines(doc: string, from: number, to: number, prefix: string): TextEdit {
  const start = from === 0 ? 0 : doc.lastIndexOf('\n', from - 1) + 1;
  const lineBreak = doc.indexOf('\n', to);
  const end = lineBreak === -1 ? doc.length : lineBreak;
  const lines = doc.slice(start, end).split('\n');
  const removing = lines.every((line) => line.startsWith(prefix));
  const insert = lines.map((line) => (removing ? line.slice(prefix.length) : prefix + line)).join('\n');
  return edit(start, end, insert, start, start + insert.length);
}

/** Toolbar and shortcut formatting. Each kind maps to one edit, so buttons and keys always agree. */
export type FormatKind = 'bold' | 'italic' | 'code' | 'link' | 'quote' | 'bullet' | 'numbered' | 'task';

export function formatAction(kind: FormatKind, doc: string, from: number, to: number): TextEdit {
  switch (kind) {
    case 'bold':
      return wrapSelection(doc, from, to, '**');
    case 'italic':
      return wrapSelection(doc, from, to, '*');
    case 'code':
      return wrapSelection(doc, from, to, '`');
    case 'link':
      return linkAroundSelection(doc, from, to);
    case 'quote':
      return prefixLines(doc, from, to, '> ');
    case 'bullet':
      return prefixLines(doc, from, to, '- ');
    case 'numbered':
      return prefixLines(doc, from, to, '1. ');
    case 'task':
      return prefixLines(doc, from, to, '- [ ] ');
  }
}

/** Counts characters the way people do: an emoji is one character. */
export function countCharacters(text: string): number {
  return [...text].length;
}

export function isOverLimit(text: string): boolean {
  return countCharacters(text) > COMMENT_MAX_CHARS;
}

function edit(from: number, to: number, insert: string, anchor: number, head: number): TextEdit {
  return { changes: { from, to, insert }, selection: { anchor, head } };
}
