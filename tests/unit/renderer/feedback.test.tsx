// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionBanner, InlineError } from '../../../src/renderer/src/Feedback';
import type { ConnectionStatus } from '../../../src/shared/connection';

afterEach(() => cleanup());

describe('ConnectionBanner', () => {
  it('stays out of the way while data is fresh', () => {
    const status: ConnectionStatus = { state: 'fresh', lastSuccessAt: Date.now(), nextRetryAt: null };
    const { container } = render(
      <ConnectionBanner status={status} onRefresh={vi.fn()} refreshBlocked={false} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('announces offline state politely, keeps the last update time, and offers a manual refresh', () => {
    const onRefresh = vi.fn();
    const status: ConnectionStatus = {
      state: 'offline',
      lastSuccessAt: Date.now() - 5 * 60_000,
      nextRetryAt: Date.now() + 60_000
    };
    render(<ConnectionBanner status={status} onRefresh={onRefresh} refreshBlocked={false} />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Offline');
    expect(banner).toHaveTextContent('Last updated 5 min ago');
    expect(banner).toHaveTextContent('Changes are paused');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('disables manual refresh while a cooldown or rate limit blocks it', () => {
    const status: ConnectionStatus = {
      state: 'rate-limited',
      lastSuccessAt: null,
      nextRetryAt: Date.now() + 600_000
    };
    render(<ConnectionBanner status={status} onRefresh={vi.fn()} refreshBlocked />);
    expect(screen.getByRole('button', { name: 'Refresh now' })).toBeDisabled();
  });
});

describe('InlineError', () => {
  it('announces the message as an alert with retry and copy-diagnostics actions', () => {
    const onRetry = vi.fn();
    const onCopy = vi.fn();
    render(
      <InlineError message="Could not load repositories." onRetry={onRetry} onCopyDiagnostics={onCopy} />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load repositories.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onCopy).toHaveBeenCalledTimes(1);
  });
});
