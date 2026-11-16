import { useEffect, useRef } from 'react';
import { appToaster, TOAST_MS } from '../toasts/app-toaster';

export interface NotificationToast {
  id: number;
  title: string;
  body: string;
  /** Thread to open when the toast is activated. Null for summaries and failures, which have nothing to open. */
  threadId: string | null;
  tone: 'info' | 'error';
}

/**
 * Keeps the queue to `limit` entries. Info toasts go first, oldest first; errors are
 * kept until the user dismisses them, even when that leaves the queue longer.
 */
export function trimToastQueue(queue: NotificationToast[], limit: number): NotificationToast[] {
  let next = queue;
  while (next.length > limit) {
    const index = next.findIndex((entry) => entry.tone === 'info');
    next = next.filter((_, position) => position !== (index === -1 ? 0 : index));
  }
  return next;
}

interface NotificationToastsProps {
  toasts: NotificationToast[];
  onOpen: (threadId: string) => void;
  onDismiss: (id: number) => void;
}

/**
 * Shows the app's notification queue on the shared toaster (AppToasts renders it). The app owns the queue and its
 * limits; this pushes each new entry, closes the ones the app dropped, and reports the user's dismissals and opens.
 * Renders nothing itself.
 */
export function NotificationToasts({ toasts, onOpen, onDismiss }: NotificationToastsProps) {
  const shown = useRef(new Map<number, true>());
  const handlers = useRef({ onOpen, onDismiss });
  useEffect(() => {
    handlers.current = { onOpen, onDismiss };
  });

  useEffect(() => {
    const current = new Set(toasts.map((entry) => entry.id));
    for (const id of [...shown.current.keys()]) {
      if (!current.has(id)) {
        appToaster.dismiss(`notice-${id}`);
        shown.current.delete(id);
      }
    }
    for (const entry of toasts) {
      if (shown.current.has(entry.id)) continue;
      shown.current.set(entry.id, true);
      appToaster(entry.title, {
        id: `notice-${entry.id}`,
        description: entry.body,
        type: entry.tone === 'error' ? 'error' : 'info',
        priority: entry.tone === 'error' ? 'assertive' : 'polite',
        duration: entry.tone === 'error' ? Infinity : TOAST_MS,
        action:
          entry.threadId === null
            ? undefined
            : {
                label: 'Open',
                onAction: () => handlers.current.onOpen(entry.threadId as string)
              },
        onDismiss: () => {
          shown.current.delete(entry.id);
          handlers.current.onDismiss(entry.id);
        }
      });
    }
  }, [toasts]);

  return null;
}
