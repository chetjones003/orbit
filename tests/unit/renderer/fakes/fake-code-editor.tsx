import * as React from 'react';
import {
  formatAction,
  type FormatKind,
  type TextEdit
} from '../../../../src/renderer/src/comments/markdown-edit';

/**
 * Textarea stand-in for the CodeMirror editor, for component tests. jsdom cannot lay out CodeMirror,
 * so this honours the same handle: formatting, applied edits, the cursor, and pasted files.
 */
export const FakeCodeEditor = React.forwardRef(function FakeCodeEditor(
  {
    value,
    onChange,
    onSubmit,
    ariaLabel,
    onFiles
  }: {
    value: string;
    onChange: (t: string) => void;
    onSubmit: () => void;
    ariaLabel: string;
    onFiles?: (files: File[], at: number) => void;
  },
  ref: React.Ref<{
    apply: (e: TextEdit) => void;
    format: (k: FormatKind) => void;
    cursor: () => number;
    focus: () => void;
  }>
) {
  const area = React.useRef<HTMLTextAreaElement>(null);
  React.useImperativeHandle(ref, () => ({
    apply: (edit) => {
      const el = area.current;
      if (!el) return;
      const { from, to, insert } = edit.changes;
      onChange(el.value.slice(0, from) + insert + el.value.slice(to));
    },
    format: (kind) => {
      const el = area.current;
      if (!el) return;
      const edit = formatAction(kind, el.value, el.selectionStart, el.selectionEnd);
      onChange(el.value.slice(0, edit.changes.from) + edit.changes.insert + el.value.slice(edit.changes.to));
    },
    cursor: () => area.current?.selectionStart ?? 0,
    focus: () => area.current?.focus()
  }));
  return (
    <textarea
      ref={area}
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') onSubmit();
      }}
      onPaste={(event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length === 0 || !onFiles) return;
        event.preventDefault();
        onFiles(files, event.currentTarget.selectionStart);
      }}
    />
  );
});
