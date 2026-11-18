// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConflictPath, ConflictSet } from '../../../src/shared/conflicts';
import { ConflictResolver } from '../../../src/renderer/src/conflicts/ConflictResolver';
import { resetConflictCache } from '../../../src/renderer/src/conflicts/conflict-cache';

// jsdom cannot lay out CodeMirror. The editor is replaced by a textarea that reports the keys it was given, and
// shows the keep buttons the real editor draws above the first block.
vi.mock('../../../src/renderer/src/conflicts/FileEditor', () => ({
  FileEditor: ({
    value,
    onChange,
    keys,
    ariaLabel,
    sideLabels,
    onKeep
  }: {
    value: string;
    onChange: (text: string) => void;
    keys: string;
    ariaLabel: string;
    sideLabels?: { head: string; base: string };
    onKeep?: (block: number, choice: 'head' | 'base' | 'both') => void;
  }) => (
    <>
      <textarea
        aria-label={ariaLabel}
        data-keys={keys}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" onClick={() => onKeep?.(0, 'head')}>
        Keep {sideLabels?.head}
      </button>
      <button type="button" onClick={() => onKeep?.(0, 'base')}>
        Keep {sideLabels?.base}
      </button>
      <button type="button" onClick={() => onKeep?.(0, 'both')}>
        Keep both
      </button>
    </>
  )
}));

const conflicted: ConflictPath = {
  path: 'src/engine.cpp',
  changedOnHead: true,
  changedOnBase: true,
  unsupported: null,
  ancestorBlob: 'anc',
  headBlob: 'head',
  headMode: '100644',
  baseBlob: 'base',
  baseMode: '100644',
  texts: {
    ancestor: 'int a;\nint b;\n',
    head: 'int a;\nint headVersion;\n',
    base: 'int a;\nint baseVersion;\n'
  }
};

const baseOnly: ConflictPath = {
  path: 'docs/notes.md',
  changedOnHead: false,
  changedOnBase: true,
  unsupported: null,
  ancestorBlob: 'old',
  headBlob: 'old',
  headMode: '100644',
  baseBlob: 'new-blob',
  baseMode: '100644',
  texts: null
};

function conflictSet(paths: ConflictPath[]): ConflictSet {
  return {
    headRef: 'feature',
    headSha: 'head-1',
    headInRepo: true,
    baseRef: 'main',
    baseSha: 'base-1',
    mergeBaseSha: 'merge-1',
    paths
  };
}

function installApi(set: ConflictSet) {
  const pulls = {
    conflicts: vi.fn(async () => set),
    resolveConflicts: vi.fn(async () => ({ sha: 'commit-abcdef123' }))
  };
  Object.defineProperty(window, 'orbit', {
    configurable: true,
    value: { pulls, settings: { get: vi.fn(async () => ({ editorKeys: 'vim' })) } }
  });
  return pulls;
}

describe('ConflictResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetConflictCache();
  });
  afterEach(() => {
    cleanup();
  });

  it('lists the conflicting file and opens it with markers, in the chosen keys', async () => {
    installApi(conflictSet([conflicted, baseOnly]));
    render(<ConflictResolver repoFullName="owner/app" number={3} onClose={() => {}} onResolved={() => {}} />);

    expect(await screen.findByRole('button', { name: /src\/engine\.cpp/ })).toBeInTheDocument();
    expect(screen.getByText(/1 file, 1 to resolve/)).toBeInTheDocument();
    const editor = screen.getByRole('textbox', { name: 'Resolved text of src/engine.cpp' });
    expect((editor as HTMLTextAreaElement).value).toContain('<<<<<<< feature');
    expect(editor).toHaveAttribute('data-keys', 'vim');
    expect(screen.getByText(/1 file changed only on main will be included/)).toBeInTheDocument();
  });

  it('keeps one side of a block and enables the commit only when no markers remain', async () => {
    installApi(conflictSet([conflicted]));
    render(<ConflictResolver repoFullName="owner/app" number={3} onClose={() => {}} onResolved={() => {}} />);

    const commit = await screen.findByRole('button', { name: 'Commit resolution' });
    expect(commit).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep feature' }));
    expect(commit).toBeEnabled();
    expect(screen.getByRole('textbox', { name: 'Resolved text of src/engine.cpp' })).toHaveValue(
      'int a;\nint headVersion;\n'
    );
  });

  it('commits against the shas it showed, with the resolved and base-only files', async () => {
    const pulls = installApi(conflictSet([conflicted, baseOnly]));
    const onResolved = vi.fn();
    render(
      <ConflictResolver repoFullName="owner/app" number={3} onClose={() => {}} onResolved={onResolved} />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Keep both' }));
    fireEvent.click(screen.getByRole('button', { name: 'Commit resolution' }));

    await waitFor(() =>
      expect(pulls.resolveConflicts).toHaveBeenCalledWith('owner/app', 3, {
        expectedHeadSha: 'head-1',
        expectedBaseSha: 'base-1',
        files: [
          {
            kind: 'text',
            path: 'src/engine.cpp',
            content: 'int a;\nint headVersion;\nint baseVersion;\n',
            mode: '100644'
          },
          { kind: 'blob', path: 'docs/notes.md', sha: 'new-blob', mode: '100644' }
        ]
      })
    );
    expect(await screen.findByText('Conflicts resolved.')).toBeInTheDocument();
    expect(screen.getByText(/Committed commit-/)).toBeInTheDocument();
    expect(onResolved).toHaveBeenCalled();
  });

  it('explains a blocked file and keeps the commit disabled', async () => {
    installApi(
      conflictSet([
        {
          ...conflicted,
          path: 'logo.png',
          texts: null,
          unsupported: 'Orbit cannot merge this file: it is a binary file.'
        }
      ])
    );
    render(<ConflictResolver repoFullName="owner/app" number={3} onClose={() => {}} onResolved={() => {}} />);

    expect(await screen.findByText(/it is a binary file/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Commit resolution' })).toBeDisabled();
  });

  it('shows a clear error when the conflicts cannot be loaded', async () => {
    const pulls = installApi(conflictSet([]));
    pulls.conflicts.mockRejectedValueOnce(new Error('GitHub is unreachable.'));
    render(<ConflictResolver repoFullName="owner/app" number={3} onClose={() => {}} onResolved={() => {}} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub is unreachable.');
  });
});
