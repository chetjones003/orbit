// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeEditor } from '../../../src/renderer/src/comments/CodeEditor';

/** The real CodeMirror editor, driven through its keymap. Layout is not measured in jsdom, so only keys and text are checked. */
function mount(value: string) {
  const onChange = vi.fn();
  const onSubmit = vi.fn();
  const { container } = render(
    <CodeEditor value={value} onChange={onChange} onSubmit={onSubmit} ariaLabel="Comment source" />
  );
  const content = container.querySelector('.cm-content') as HTMLElement;
  return { content, onChange, onSubmit };
}

describe('CodeEditor (CodeMirror 6)', () => {
  afterEach(() => cleanup());

  it('exposes a labelled multiline textbox holding the initial text', () => {
    const { content } = mount('# Heading');

    expect(content).toHaveAttribute('aria-label', 'Comment source');
    expect(content).toHaveTextContent('# Heading');
  });

  it('submits on Ctrl+Enter', () => {
    const { content, onSubmit } = mount('ready');

    fireEvent.keyDown(content, { key: 'Enter', ctrlKey: true });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
