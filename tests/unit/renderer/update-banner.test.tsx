// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateBanner } from '../../../src/renderer/src/updates/UpdateBanner';

afterEach(() => cleanup());

const handlers = () => ({
  onCheck: vi.fn(),
  onInstall: vi.fn(async () => undefined),
  hasUnsavedDrafts: vi.fn(() => false)
});

describe('UpdateBanner', () => {
  it('stays out of the way when there is nothing to report', () => {
    const { container } = render(<UpdateBanner status={{ kind: 'idle' }} {...handlers()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows download progress as a polite status', () => {
    render(<UpdateBanner status={{ kind: 'downloading', version: '0.2.0', percent: 40 }} {...handlers()} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Downloading Orbit 0.2.0');
    expect(status).toHaveTextContent('40%');
  });

  it('offers the version and release notes, and restarts only when the user confirms', async () => {
    const h = handlers();
    render(
      <UpdateBanner
        status={{ kind: 'ready', version: '0.2.0', releaseNotes: 'Fixes the Kanban board.' }}
        {...h}
      />
    );
    expect(screen.getByText(/Orbit 0.2.0 is ready/)).toBeInTheDocument();
    expect(screen.getByText('Fixes the Kanban board.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
    expect(h.onInstall).toHaveBeenCalledTimes(1);
  });

  it('warns about unsaved drafts before restarting, and does not restart until the user agrees', () => {
    const h = handlers();
    h.hasUnsavedDrafts.mockReturnValue(true);
    render(<UpdateBanner status={{ kind: 'ready', version: '0.2.0', releaseNotes: null }} {...h} />);

    fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('unsent');
    expect(h.onInstall).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(h.onInstall).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restart anyway' }));
    expect(h.onInstall).toHaveBeenCalledTimes(1);
  });

  it('tells macOS users the DMG is open and does not offer a restart', () => {
    render(<UpdateBanner status={{ kind: 'mac-opened', version: '0.2.0' }} {...handlers()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Drag Orbit into Applications');
    expect(screen.queryByRole('button', { name: 'Restart to update' })).toBeNull();
  });

  it('shows one calm error with a retry, without repeating it', () => {
    const h = handlers();
    render(
      <UpdateBanner
        status={{ kind: 'error', message: 'Orbit could not check for or download an update.' }}
        {...h}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('could not check');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(h.onCheck).toHaveBeenCalledTimes(1);
  });
});
