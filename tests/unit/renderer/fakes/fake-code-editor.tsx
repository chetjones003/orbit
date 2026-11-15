import * as React from 'react';
import { formatAction, type FormatKind } from '../../../../src/renderer/src/comments/markdown-edit';

/**
 * Textarea stand-in for the CodeMirror editor, for component tests. jsdom cannot lay out CodeMirror,
 * so this honours the same handle. The toolbar still runs the real formatting rules.
 */
export const FakeCodeEditor = React.forwardRef(function FakeCodeEditor(
  {
    value,
    onChange,
    onSubmit,
    ariaLabel
  }: { value: string; onChange: (t: string) => void; onSubmit: () => void; ariaLabel: string },
  ref: React.Ref<{ apply: (e: unknown) => void; format: (k: FormatKind) => void; focus: () => void }>
) {
  const area = React.useRef<HTMLTextAreaElement>(null);
  React.useImperativeHandle(ref, () => ({
    apply: () => undefined,
    format: (kind) => {
      const el = area.current;
      if (!el) return;
      const edit = formatAction(kind, el.value, el.selectionStart, el.selectionEnd);
      onChange(el.value.slice(0, edit.changes.from) + edit.changes.insert + el.value.slice(edit.changes.to));
    },
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
    />
  );
});
