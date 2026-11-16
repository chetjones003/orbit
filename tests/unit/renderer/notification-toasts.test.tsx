// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppToasts } from '../../../src/renderer/src/toasts/AppToasts';
import { appToaster } from '../../../src/renderer/src/toasts/app-toaster';
import {
  NotificationToasts,
  trimToastQueue,
  type NotificationToast
} from '../../../src/renderer/src/notifications/NotificationToasts';

function toast(id: number, overrides: Partial<NotificationToast> = {}): NotificationToast {
  return {
    id,
    title: `orbit-owner/app #${id}`,
    body: `Mention: Thread ${id}`,
    threadId: String(id),
    tone: 'info',
    ...overrides
  };
}

function renderToasts(props: {
  toasts: NotificationToast[];
  onOpen?: (threadId: string) => void;
  onDismiss?: (id: number) => void;
}) {
  return render(
    <>
      <AppToasts />
      <NotificationToasts
        toasts={props.toasts}
        onOpen={props.onOpen ?? vi.fn()}
        onDismiss={props.onDismiss ?? vi.fn()}
      />
    </>
  );
}

describe('NotificationToasts', () => {
  afterEach(() => {
    appToaster.dismiss();
    cleanup();
  });

  it('shows each notification with its repo and text in the Notifications region', async () => {
    renderToasts({ toasts: [toast(1)] });

    const region = await screen.findByRole('region', { name: 'Notifications' });
    expect(region).toHaveTextContent('orbit-owner/app #1');
    expect(region).toHaveTextContent('Mention: Thread 1');
  });

  it('opens the notification from its Open action', async () => {
    const onOpen = vi.fn();
    renderToasts({ toasts: [toast(7)], onOpen });

    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));

    expect(onOpen).toHaveBeenCalledWith('7');
  });

  it('offers no Open action for a summary, which has no item to navigate to', async () => {
    renderToasts({
      toasts: [toast(1, { threadId: null, title: 'Orbit', body: '5 new GitHub notifications' })]
    });

    const region = await screen.findByRole('region', { name: 'Notifications' });
    expect(region).toHaveTextContent('5 new GitHub notifications');
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
  });

  it('dismisses one notification without opening it', async () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    renderToasts({ toasts: [toast(3)], onOpen, onDismiss });

    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(onDismiss).toHaveBeenCalledWith(3));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('shows no toast when there are none', () => {
    const { container } = renderToasts({ toasts: [] });

    expect(container.querySelector('.app-toast')).toBeNull();
  });

  it('removes a toast the app drops from its queue', async () => {
    const { rerender } = renderToasts({ toasts: [toast(1), toast(2)] });
    await screen.findByText('orbit-owner/app #2');

    rerender(
      <>
        <AppToasts />
        <NotificationToasts toasts={[toast(2)]} onOpen={vi.fn()} onDismiss={vi.fn()} />
      </>
    );

    await waitFor(() => expect(screen.queryByText('orbit-owner/app #1')).toBeNull());
    expect(screen.getByText('orbit-owner/app #2')).toBeInTheDocument();
  });
});

describe('trimToastQueue', () => {
  it('drops the oldest info toast first and keeps errors', () => {
    const queue = [toast(1, { tone: 'error' }), toast(2), toast(3)];
    expect(trimToastQueue(queue, 2).map((entry) => entry.id)).toEqual([1, 3]);
  });
});
