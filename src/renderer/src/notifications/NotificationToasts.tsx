/** Most toasts shown at once. Anything beyond this is summarised, so a burst cannot flood the screen. */
const MAX_VISIBLE = 3;

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
 * Animated in-app toasts for new GitHub notifications. They announce politely to
 * screen readers. Entrance animation is disabled under reduced motion in CSS.
 */
export function NotificationToasts({ toasts, onOpen, onDismiss }: NotificationToastsProps) {
  if (toasts.length === 0) return null;
  const visible = toasts.slice(0, MAX_VISIBLE);
  const hidden = toasts.length - visible.length;

  return (
    <div className="notification-toasts" role="status" aria-live="polite">
      {visible.map((entry) => (
        <div key={entry.id} className={`notification-toast notification-toast-${entry.tone}`}>
          {entry.threadId === null ? (
            <div className="notification-toast-body">
              <span className="notification-toast-title">{entry.title}</span>
              <span className="notification-toast-text">{entry.body}</span>
            </div>
          ) : (
            <button
              type="button"
              className="notification-toast-body notification-toast-open"
              onClick={() => onOpen(entry.threadId as string)}
            >
              <span className="notification-toast-title">{entry.title}</span>
              <span className="notification-toast-text">{entry.body}</span>
            </button>
          )}
          <button
            type="button"
            className="notification-toast-dismiss"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(entry.id)}
          >
            ×
          </button>
        </div>
      ))}
      {hidden > 0 && <div className="notification-toast-more">+{hidden} more notifications</div>}
    </div>
  );
}
