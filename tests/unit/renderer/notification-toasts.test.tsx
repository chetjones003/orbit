// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('NotificationToasts', () => {
  afterEach(cleanup);

  it('shows each notification with its repo and text in a polite live region', () => {
    render(<NotificationToasts toasts={[toast(1)]} onOpen={vi.fn()} onDismiss={vi.fn()} />);

    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('orbit-owner/app #1');
    expect(region).toHaveTextContent('Mention: Thread 1');
  });

  it('opens the notification when its toast is activated', () => {
    const onOpen = vi.fn();
    render(<NotificationToasts toasts={[toast(7)]} onOpen={onOpen} onDismiss={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /orbit-owner\/app #7/ }));

    expect(onOpen).toHaveBeenCalledWith('7');
  });

  it('does not offer to open a summary, which has no item to navigate to', () => {
    render(
      <NotificationToasts
        toasts={[toast(1, { threadId: null, title: 'Orbit', body: '5 new GitHub notifications' })]}
        onOpen={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: /5 new GitHub notifications/ })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('5 new GitHub notifications');
  });

  it('dismisses one notification without opening it', () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    render(<NotificationToasts toasts={[toast(3)]} onOpen={onOpen} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));

    expect(onDismiss).toHaveBeenCalledWith(3);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('caps visible toasts so a burst cannot flood the screen, and says how many are hidden', () => {
    const toasts = [1, 2, 3, 4, 5].map((n) => toast(n));
    render(<NotificationToasts toasts={toasts} onOpen={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getAllByRole('button', { name: /orbit-owner\/app #/ })).toHaveLength(3);
    expect(screen.getByText('+2 more notifications')).toBeInTheDocument();
  });

  it('renders nothing when there are no toasts', () => {
    const { container } = render(<NotificationToasts toasts={[]} onOpen={vi.fn()} onDismiss={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('trimToastQueue', () => {
  it('drops the oldest info toasts first and keeps errors until the user dismisses them', () => {
    const error = toast(0, { tone: 'error', threadId: null, title: 'Could not mark notification as read' });
    const queue = [error, ...[1, 2, 3, 4, 5].map((n) => toast(n))];

    const trimmed = trimToastQueue(queue, 3);

    expect(trimmed.map((entry) => entry.id)).toEqual([0, 4, 5]);
  });

  it('leaves a short queue unchanged', () => {
    const queue = [toast(1), toast(2)];

    expect(trimToastQueue(queue, 3)).toEqual(queue);
  });
});
