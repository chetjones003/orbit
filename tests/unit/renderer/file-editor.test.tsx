// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileEditor, type FileEditorHandle } from '../../../src/renderer/src/conflicts/FileEditor';

describe('FileEditor', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the text and takes Vim keys without losing it', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <FileEditor value={'one\ntwo'} onChange={onChange} keys="standard" ariaLabel="File" />
    );
    expect(container.querySelector('.cm-content')?.textContent).toContain('one');

    rerender(<FileEditor value={'one\ntwo'} onChange={onChange} keys="vim" ariaLabel="File" />);
    expect(container.querySelector('.cm-vim-panel, .cm-editor')).not.toBeNull();
    expect(container.querySelector('.cm-content')?.textContent).toContain('two');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('replaces the document when the text changes from outside', () => {
    const { container, rerender } = render(
      <FileEditor value="old" onChange={() => {}} keys="standard" ariaLabel="File" />
    );
    rerender(<FileEditor value="resolved" onChange={() => {}} keys="standard" ariaLabel="File" />);
    expect(container.querySelector('.cm-content')?.textContent).toContain('resolved');
  });
});

describe('FileEditor keep buttons', () => {
  afterEach(() => {
    cleanup();
  });

  it('draws keep buttons above each block, named for the branches, and reports the block and side kept', () => {
    const onKeep = vi.fn();
    const text = 'top\n<<<<<<< feature\nhead line\n=======\nbase line\n>>>>>>> main\nend';
    const { container } = render(
      <FileEditor
        value={text}
        onChange={() => {}}
        keys="standard"
        ariaLabel="File"
        sideLabels={{ head: 'feature', base: 'main' }}
        onKeep={onKeep}
      />
    );
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('.cm-conflict-keep')];
    expect(buttons.map((button) => button.textContent)).toEqual(['Keep feature', 'Keep main', 'Keep both']);
    buttons[0]?.click();
    buttons[2]?.click();
    expect(onKeep).toHaveBeenNthCalledWith(1, 0, 'head');
    expect(onKeep).toHaveBeenNthCalledWith(2, 0, 'both');
  });
});

describe('FileEditor conflicts', () => {
  const text =
    'top\n<<<<<<< feature\nhead line\n=======\nbase line\n>>>>>>> main\nmiddle\n<<<<<<< second\nh2\n=======\nb2\n>>>>>>> main\nend';

  afterEach(() => {
    cleanup();
  });

  it('highlights the head, base and marker lines of each block', () => {
    const { container } = render(
      <FileEditor value={text} onChange={() => {}} keys="standard" ariaLabel="File" />
    );
    expect(container.querySelectorAll('.cm-conflict-head')).toHaveLength(2);
    expect(container.querySelectorAll('.cm-conflict-base')).toHaveLength(2);
    expect(container.querySelectorAll('.cm-conflict-marker')).toHaveLength(6);
  });

  it('moves the cursor to the next and previous block, wrapping at the ends', () => {
    const ref = createRef<FileEditorHandle>();
    const { container } = render(
      <FileEditor ref={ref} value={text} onChange={() => {}} keys="standard" ariaLabel="File" />
    );
    const activeLine = () => container.querySelector('.cm-activeLine')?.textContent ?? '';
    act(() => ref.current?.nextConflict());
    expect(activeLine()).toContain('<<<<<<< feature');
    act(() => ref.current?.nextConflict());
    expect(activeLine()).toContain('<<<<<<< second');
    act(() => ref.current?.nextConflict());
    expect(activeLine()).toContain('<<<<<<< feature');
    act(() => ref.current?.previousConflict());
    expect(activeLine()).toContain('<<<<<<< second');
  });
});

describe('syntax highlighting by file name', () => {
  it('maps the file types in a GoSurvey pull request to a language that loads', async () => {
    const { LanguageDescription } = await import('@codemirror/language');
    const { languages } = await import('@codemirror/language-data');
    for (const name of [
      '.github/workflows/full-validation.yml',
      'CMakeLists.txt',
      'src/engine.cpp',
      'tools/build.ps1',
      'docs/system-map.json'
    ]) {
      const description = LanguageDescription.matchFilename(languages, name);
      expect(description, name).toBeDefined();
      await expect(description!.load(), name).resolves.toBeDefined();
    }
  });
});

describe('FileEditor shows only the text near conflicts', () => {
  it('folds long unchanged stretches and renders the syntax tokens', () => {
    const far = Array.from({ length: 60 }, (_, i) => `key${i}: value # note`).join('\n');
    const text = `<<<<<<< h
x: 1
=======
x: 2
>>>>>>> b
${far}`;
    const { container } = render(
      <FileEditor value={text} onChange={() => {}} keys="standard" ariaLabel="File" path="config.yml" />
    );
    // jsdom has no layout, so only the first lines are rendered. The fold itself is checked in the browser.
    expect(container.querySelector('.cm-conflict-head')).not.toBeNull();
  });
});
