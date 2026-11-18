import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, drawSelection, keymap, placeholder } from '@codemirror/view';
import { autocompletion, type Completion } from '@codemirror/autocomplete';
import { indentMore } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { continueList, formatAction, pasteEdit, type FormatKind, type TextEdit } from './markdown-edit';
import { suggestionSource, type SuggestionContext } from './editor-suggestions';
import { markColor, markLetters } from '../shell/repo-mark';

/** Operations the composer uses for toolbar buttons. The editor owns the document; this is its surface. */
export interface CodeEditorHandle {
  apply(edit: TextEdit): void;
  format(kind: FormatKind): void;
  /** Offset of the insertion point, where attachments go. */
  cursor(): number;
  focus(): void;
}

export interface CodeEditorProps {
  /** Initial text, and text set from outside (for example after a successful save clears the box). */
  value: string;
  onChange: (text: string) => void;
  /** Ctrl/Cmd+Enter. */
  onSubmit: () => void;
  ariaLabel: string;
  placeholder?: string;
  /** Files pasted or dropped into the editor, with the offset they landed at. Without it, files are ignored. */
  onFiles?: (files: File[], at: number) => void;
  /** True while the text must not change, such as while it is being sent. The text stays visible. */
  readOnly?: boolean;
  /** Where `#` and `@` suggestions come from. `/` snippets work without it. */
  suggestions?: SuggestionContext;
}

/**
 * GitHub-flavoured Markdown source editor (CodeMirror 6). Its keys: Ctrl/Cmd+B, I, E, L format;
 * Ctrl/Cmd+Enter submits; Enter continues lists; Esc then Tab leaves the editor.
 */
export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { value, onChange, onSubmit, ariaLabel, placeholder: hint, onFiles, readOnly = false, suggestions },
  ref
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Read-only is a compartment, so it can change after the editor exists without rebuilding it.
  const editable = useRef(new Compartment());
  // Latest callbacks, so the editor is created once and never rebuilt on each render.
  const callbacks = useRef({ onChange, onSubmit, onFiles, suggestions });
  callbacks.current = { onChange, onSubmit, onFiles, suggestions };
  // Set by Esc. The next Tab then moves focus out instead of indenting.
  const released = useRef(false);

  useEffect(() => {
    if (!host.current) return;
    const editor: EditorView = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          editable.current.of(EditorState.readOnly.of(readOnly)),
          markdown({ extensions: GFM }),
          EditorView.lineWrapping,
          // The editor draws its own cursor, styled as a block, so it shows in an empty box too.
          drawSelection({ cursorBlinkRate: 1100 }),
          placeholder(hint ?? ''),
          autocompletion({
            override: [suggestionSource(() => callbacks.current.suggestions ?? {})],
            activateOnTyping: true,
            maxRenderedOptions: 12,
            closeOnBlur: true,
            tooltipClass: () => 'suggest-popup',
            optionClass: (option) => `suggest-option suggest-${(option.type ?? '').split(' ')[0] ?? ''}`,
            addToOptions: [{ render: renderAvatar, position: 20 }]
          }),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel, 'aria-multiline': 'true' }),
          keymap.of([
            { key: 'Mod-b', run: () => runFormat(editor, 'bold') },
            { key: 'Mod-i', run: () => runFormat(editor, 'italic') },
            { key: 'Mod-e', run: () => runFormat(editor, 'code') },
            { key: 'Mod-l', run: () => runFormat(editor, 'link') },
            {
              key: 'Mod-Enter',
              run: () => {
                callbacks.current.onSubmit();
                return true;
              }
            },
            {
              key: 'Enter',
              run: (target) => {
                const { head } = target.state.selection.main;
                const edit = continueList(target.state.doc.toString(), head);
                if (!edit) return false;
                target.dispatch({ changes: edit.changes, selection: edit.selection });
                return true;
              }
            },
            {
              key: 'Escape',
              run: () => {
                released.current = true;
                return true;
              }
            },
            {
              key: 'Tab',
              run: (target) => {
                if (released.current) {
                  released.current = false;
                  return false;
                }
                return indentMore(target);
              }
            }
          ]),
          EditorView.domEventHandlers({
            paste: (event, target) => {
              const data = event.clipboardData;
              if (!data) return false;
              const files = Array.from(data.files);
              if (files.length > 0 && callbacks.current.onFiles) {
                event.preventDefault();
                callbacks.current.onFiles(files, target.state.selection.main.from);
                return true;
              }
              // Plain text is inserted verbatim. Rich HTML is reduced to its text, so no markup comes in.
              const text = data.getData('text/plain') || htmlToText(data.getData('text/html'));
              if (text === '') return false;
              event.preventDefault();
              const { from, to } = target.state.selection.main;
              const edit = pasteEdit(target.state.doc.toString(), from, to, text);
              target.dispatch({ changes: edit.changes, selection: edit.selection });
              return true;
            },
            // Dragging files over the editor must be allowed, or the browser never delivers the drop. The box
            // shows it will take them while they are over it.
            dragover: (event) => {
              if (!callbacks.current.onFiles || !event.dataTransfer?.types.includes('Files')) return false;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
              host.current?.classList.add('drop-ready');
              return true;
            },
            dragleave: (event) => {
              if (host.current?.contains(event.relatedTarget as Node | null)) return false;
              host.current?.classList.remove('drop-ready');
              return false;
            },
            drop: (event, target) => {
              host.current?.classList.remove('drop-ready');
              const files = Array.from(event.dataTransfer?.files ?? []);
              if (files.length === 0 || !callbacks.current.onFiles) return false;
              event.preventDefault();
              const at =
                target.posAtCoords({ x: event.clientX, y: event.clientY }) ?? target.state.doc.length;
              callbacks.current.onFiles(files, at);
              return true;
            }
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            released.current = false;
            callbacks.current.onChange(update.state.doc.toString());
          })
        ]
      })
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // The editor is created once; `value` and the labels are synced by the effects below.
  }, []);

  // Text changed from outside (for example a cleared box after save). Skip when it already matches.
  useEffect(() => {
    view.current?.dispatch({ effects: editable.current.reconfigure(EditorState.readOnly.of(readOnly)) });
  }, [readOnly]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);

  useImperativeHandle(
    ref,
    () => ({
      apply: (edit) => {
        view.current?.dispatch({ changes: edit.changes, selection: edit.selection });
      },
      format: (kind) => {
        if (view.current) runFormat(view.current, kind);
      },
      cursor: () => view.current?.state.selection.main.head ?? 0,
      focus: () => view.current?.focus()
    }),
    []
  );

  return <div className="comment-editor" ref={host} />;
});

/** A person suggestion's avatar: their initials on a colour picked from their login. */
function renderAvatar(completion: Completion): Node | null {
  if (completion.type !== 'person') return null;
  const login = typeof completion.displayLabel === 'string' ? completion.displayLabel : completion.label;
  const avatar = document.createElement('span');
  avatar.className = 'suggest-avatar';
  avatar.textContent = markLetters(login);
  avatar.style.background = markColor(login);
  avatar.setAttribute('aria-hidden', 'true');
  return avatar;
}

function runFormat(editor: EditorView, kind: FormatKind): boolean {
  const { from, to } = editor.state.selection.main;
  const edit = formatAction(kind, editor.state.doc.toString(), from, to);
  editor.dispatch({ changes: edit.changes, selection: edit.selection });
  return true;
}

/** Text of an HTML clipboard fragment, without any of its markup. */
function htmlToText(html: string): string {
  if (html === '') return '';
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
}
