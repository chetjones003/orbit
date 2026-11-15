import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { indentMore } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { continueList, formatAction, pasteEdit, type FormatKind, type TextEdit } from './markdown-edit';

/** Operations the composer uses for toolbar buttons. The editor owns the document; this is its surface. */
export interface CodeEditorHandle {
  apply(edit: TextEdit): void;
  format(kind: FormatKind): void;
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
}

/**
 * GitHub-flavoured Markdown source editor (CodeMirror 6). Its keys: Ctrl/Cmd+B, I, E, K format;
 * Ctrl/Cmd+Enter submits; Enter continues lists; Esc then Tab leaves the editor.
 */
export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { value, onChange, onSubmit, ariaLabel, placeholder: hint },
  ref
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Latest callbacks, so the editor is created once and never rebuilt on each render.
  const callbacks = useRef({ onChange, onSubmit });
  callbacks.current = { onChange, onSubmit };
  // Set by Esc. The next Tab then moves focus out instead of indenting.
  const released = useRef(false);

  useEffect(() => {
    if (!host.current) return;
    const editor: EditorView = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          markdown({ extensions: GFM }),
          EditorView.lineWrapping,
          placeholder(hint ?? ''),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel, 'aria-multiline': 'true' }),
          keymap.of([
            { key: 'Mod-b', run: () => runFormat(editor, 'bold') },
            { key: 'Mod-i', run: () => runFormat(editor, 'italic') },
            { key: 'Mod-e', run: () => runFormat(editor, 'code') },
            { key: 'Mod-k', run: () => runFormat(editor, 'link') },
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
              // Plain text is inserted verbatim. Rich HTML is reduced to its text, so no markup comes in.
              const text = data.getData('text/plain') || htmlToText(data.getData('text/html'));
              if (text === '') return false;
              event.preventDefault();
              const { from, to } = target.state.selection.main;
              const edit = pasteEdit(target.state.doc.toString(), from, to, text);
              target.dispatch({ changes: edit.changes, selection: edit.selection });
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
      focus: () => view.current?.focus()
    }),
    []
  );

  return <div className="comment-editor" ref={host} />;
});

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
