import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Compartment, EditorState, StateField, type Range, type Text } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  WidgetType,
  keymap,
  lineNumbers,
  highlightActiveLine,
  type DecorationSet
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  HighlightStyle,
  LanguageDescription,
  codeFolding,
  foldEffect,
  syntaxHighlighting,
  type LanguageSupport
} from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { languages } from '@codemirror/language-data';
import { vim } from '@replit/codemirror-vim';
import type { EditorKeys } from '../../../shared/ipc';
import { conflictBlocks, conflictStartLines, nearestConflict, type BlockChoice } from './merge3';
import { foldableStretches } from './context';

/** Colors for syntax tokens. Read on the dark theme, which is the app's default. */
const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: '#c792ea' },
  { tag: [tags.string, tags.special(tags.string)], color: '#a5d6a7' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: '#f78c6c' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: '#7f8a99', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#82aaff' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: '#ffcb6b' },
  { tag: [tags.propertyName, tags.attributeName, tags.labelName], color: '#f07178' },
  { tag: [tags.heading, tags.strong], fontWeight: 'bold' },
  { tag: tags.link, color: '#82aaff', textDecoration: 'underline' },
  { tag: [tags.meta, tags.processingInstruction, tags.punctuation], color: '#89ddff' }
]);

/** Folds away the unchanged stretches far from every conflict. Clicking the placeholder shows them. */
function foldFarText(editor: EditorView, text: string): void {
  const doc = editor.state.doc;
  const effects = foldableStretches(text).map(([anchor, last]) =>
    foldEffect.of({ from: doc.line(anchor + 1).to, to: doc.line(last + 1).to })
  );
  if (effects.length > 0) editor.dispatch({ effects });
}

/** The names of the two branches, shown on the buttons above each conflict. */
export interface SideLabels {
  head: string;
  base: string;
}

const DEFAULT_LABELS: SideLabels = { head: 'head', base: 'base' };

/** Keeps one side of a conflict block, or both. The block is the index of the block in the file, from the top. */
type KeepChooser = (block: number, choice: BlockChoice) => void;

export interface FileEditorProps {
  /** The file's current text. Changes from outside (a conflict block resolved) replace the document. */
  value: string;
  onChange: (text: string) => void;
  /** Standard editing, or Vim modal editing. Changing it takes effect at once, and keeps the text. */
  keys: EditorKeys;
  ariaLabel: string;
  /** The file's path. It picks the syntax highlighting, by file name. Without it the text is plain. */
  path?: string;
  /** Long lines wrap onto the next line. Changing it takes effect at once. */
  wrap?: boolean;
  /** The branch names on the keep buttons. Read when the editor opens. */
  sideLabels?: SideLabels;
  /** Keeps one side of a conflict block. The caller writes the new text back through `value`. */
  onKeep?: KeepChooser;
}

export interface FileEditorHandle {
  /** Moves the cursor to the next conflict block, wrapping to the first. */
  nextConflict(): void;
  /** Moves the cursor to the previous conflict block, wrapping to the last. */
  previousConflict(): void;
}

/** The buttons drawn above a conflict block: keep the head's lines, the base's lines, or both. */
class KeepButtons extends WidgetType {
  block: number;
  labels: SideLabels;
  choose: KeepChooser;

  constructor(block: number, labels: SideLabels, choose: KeepChooser) {
    super();
    this.block = block;
    this.labels = labels;
    this.choose = choose;
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof KeepButtons &&
      other.block === this.block &&
      other.labels.head === this.labels.head &&
      other.labels.base === this.labels.base
    );
  }

  override toDOM(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'cm-conflict-actions';
    const options: Array<[string, BlockChoice]> = [
      [`Keep ${this.labels.head}`, 'head'],
      [`Keep ${this.labels.base}`, 'base'],
      ['Keep both', 'both']
    ];
    for (const [label, choice] of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cm-conflict-keep';
      button.textContent = label;
      // Keeps the editor's focus and selection where they were.
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => this.choose(this.block, choice));
      bar.append(button);
    }
    return bar;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/** Marks each conflict block: its keep buttons above it, and each of its lines by side. */
function conflictDecorations(doc: Text, labels: SideLabels, choose: KeepChooser): DecorationSet {
  const marks: Range<Decoration>[] = [];
  const mark = (line: number, className: string): void => {
    marks.push(Decoration.line({ class: className }).range(doc.line(line + 1).from));
  };
  conflictBlocks(doc.toString()).forEach((block, index) => {
    const separator = block.start + 1 + block.head.length;
    const close = block.end - 1;
    marks.push(
      Decoration.widget({ widget: new KeepButtons(index, labels, choose), block: true, side: -1 }).range(
        doc.line(block.start + 1).from
      )
    );
    mark(block.start, 'cm-conflict-marker cm-conflict-marker-head');
    for (let line = block.start + 1; line < separator; line++) mark(line, 'cm-conflict-head');
    mark(separator, 'cm-conflict-marker');
    for (let line = separator + 1; line < close; line++) mark(line, 'cm-conflict-base');
    mark(close, 'cm-conflict-marker cm-conflict-marker-base');
  });
  return Decoration.set(marks, true);
}

function conflictField(labels: SideLabels, choose: KeepChooser): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create: (state) => conflictDecorations(state.doc, labels, choose),
    update: (value, transaction) =>
      transaction.docChanged ? conflictDecorations(transaction.newDoc, labels, choose) : value,
    provide: (field) => EditorView.decorations.from(field)
  });
}

/** Syntax highlighting for a path, or nothing when no language matches its name. */
async function loadLanguage(path: string | undefined): Promise<LanguageSupport | null> {
  if (!path) return null;
  const description = LanguageDescription.matchFilename(languages, path);
  if (!description) return null;
  return description.load();
}

/**
 * A plain-text editor for one file, with standard keys or Vim. Conflict blocks are highlighted, each with its own keep
 * buttons, and the handle moves between them. Callers keep one editor per file by keying it on the file's path, so
 * switching files starts fresh.
 */
export const FileEditor = forwardRef<FileEditorHandle, FileEditorProps>(function FileEditor(
  { value, onChange, keys, ariaLabel, path, wrap = false, sideLabels, onKeep },
  ref
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const keyMode = useRef(new Compartment());
  const language = useRef(new Compartment());
  const wrapping = useRef(new Compartment());
  // The latest callbacks, so the editor is created once and is not rebuilt on each render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onKeepRef = useRef(onKeep);
  onKeepRef.current = onKeep;

  useImperativeHandle(ref, () => ({
    nextConflict: () => jump('next'),
    previousConflict: () => jump('previous')
  }));

  const jump = (direction: 'next' | 'previous'): void => {
    const editor = view.current;
    if (!editor) return;
    const doc = editor.state.doc;
    const cursorLine = doc.lineAt(editor.state.selection.main.head).number - 1;
    const target = nearestConflict(conflictStartLines(doc.toString()), cursorLine, direction);
    if (target === null) return;
    const at = doc.line(target + 1).from;
    editor.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) });
    editor.focus();
  };

  useEffect(() => {
    if (!host.current) return;
    const choose: KeepChooser = (block, choice) => onKeepRef.current?.(block, choice);
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          keyMode.current.of(keys === 'vim' ? vim() : []),
          language.current.of([]),
          wrapping.current.of(wrap ? EditorView.lineWrapping : []),
          conflictField(sideLabels ?? DEFAULT_LABELS, choose),
          syntaxHighlighting(highlightStyle),
          codeFolding({ placeholderText: ' ⋯ unchanged lines ⋯ ' }),
          lineNumbers(),
          highlightActiveLine(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          })
        ]
      })
    });
    view.current = editor;
    foldFarText(editor, value);
    return () => {
      editor.destroy();
      view.current = null;
    };
    // The editor is created once. Text, keys and language are synced below, so it is not rebuilt on each change.
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({ effects: keyMode.current.reconfigure(keys === 'vim' ? vim() : []) });
  }, [keys]);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({ effects: wrapping.current.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap]);

  useEffect(() => {
    let cancelled = false;
    void loadLanguage(path).then((support) => {
      const editor = view.current;
      if (cancelled || !editor) return;
      editor.dispatch({ effects: language.current.reconfigure(support ?? []) });
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    if (editor.state.doc.toString() === value) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    foldFarText(editor, value);
  }, [value]);

  return <div className="file-editor" ref={host} data-keys={keys} />;
});
