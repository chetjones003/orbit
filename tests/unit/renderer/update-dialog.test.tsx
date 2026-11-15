// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateDialog, type UpdateDialogProps } from '../../../src/renderer/src/updates/UpdateDialog';
import { plainReleaseNotes } from '../../../src/renderer/src/updates/release-notes';
import type { UpdateStatus } from '../../../src/shared/updates';

function setup(status: UpdateStatus, overrides: Partial<UpdateDialogProps> = {}) {
  const props: UpdateDialogProps = {
    status,
    currentVersion: '0.1.0',
    onClose: vi.fn(),
    onCheck: vi.fn(),
    onDownload: vi.fn(),
    onInstall: vi.fn(async () => undefined),
    hasUnsavedDrafts: () => false,
    ...overrides
  };
  render(<UpdateDialog {...props} />);
  return props;
}

const dialog = () => screen.getByRole('dialog', { name: /./ });

describe('UpdateDialog', () => {
  afterEach(() => cleanup());

  it('asks before downloading: the offer shows the notes, and only the button starts the download', () => {
    const props = setup({ kind: 'available', version: '0.2.0', releaseNotes: '## Projects\n- Views' });
    expect(within(dialog()).getByText('0.2.0', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Projects/)).toBeInTheDocument();
    expect(props.onDownload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onDownload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Download and install' }));
    expect(props.onDownload).toHaveBeenCalledTimes(1);
  });

  it('shows download progress as a progress bar', () => {
    setup({ kind: 'downloading', version: '0.2.0', percent: 42.4 });
    const bar = screen.getByRole('progressbar', { name: 'Downloading Orbit 0.2.0' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
  });

  it('says so when the newest release is already installed', () => {
    setup({ kind: 'up-to-date', checkedAt: 1 });
    expect(screen.getByText('You have the newest release.')).toBeInTheDocument();
    expect(screen.getByText('You have Orbit 0.1.0')).toBeInTheDocument();
  });

  it('restarts only after confirmation, and warns first when drafts would be lost', async () => {
    const onInstall = vi.fn(async () => undefined);
    setup(
      { kind: 'ready', version: '0.2.0', releaseNotes: null },
      { onInstall, hasUnsavedDrafts: () => true }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
    expect(onInstall).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Restart to update' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restart anyway' }));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it('restarts straight away when nothing unsent would be lost', () => {
    const onInstall = vi.fn(async () => undefined);
    setup({ kind: 'ready', version: '0.2.0', releaseNotes: null }, { onInstall });
    fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it('shows a failure without details and offers to try again', () => {
    const props = setup({ kind: 'error', message: 'Orbit could not download the update.' });
    expect(screen.getByRole('alert')).toHaveTextContent('Orbit could not download the update.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onCheck).toHaveBeenCalledTimes(1);
  });
});

describe('plainReleaseNotes', () => {
  it('keeps Markdown as it is, trimmed', () => {
    expect(plainReleaseNotes('  ## Title\n- one  ')).toBe('## Title\n- one');
  });

  it('turns HTML into readable text with bullets, and never keeps the markup', () => {
    const text = plainReleaseNotes(
      '<h2>What changed</h2><ul><li>Projects</li><li>CI graph</li></ul><p>Done</p>'
    );
    expect(text).toContain('What changed');
    expect(text).toContain('• Projects');
    expect(text).toContain('• CI graph');
    expect(text).not.toContain('<');
  });
});
