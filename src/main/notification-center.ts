import { desktopNotices, type DesktopNotice } from './notification-policy';
import type {
  NotificationDelivery,
  NotificationItem,
  NotificationTarget
} from './github/notification-service';

/** The part of the notification service the center needs. */
export interface NotificationPort {
  poll(): Promise<{ pollIntervalMs?: number; delivery: NotificationDelivery | null }>;
  markRead(threadId: string): Promise<void>;
}

export interface NotificationCenterOptions {
  service: NotificationPort;
  /** True while the Orbit window has focus. Focused windows show toasts instead of desktop notices. */
  isFocused: () => boolean;
  /** Sends a delivery to the renderer for in-app toasts. */
  deliver: (delivery: NotificationDelivery) => void;
  /** Shows one desktop notification. */
  notify: (notice: DesktopNotice) => void;
  /** How many delivered items stay openable. Older ones are dropped to bound memory. */
  rememberLimit?: number;
}

export interface NotificationOpenResult {
  target: NotificationTarget | null;
  /** Set when GitHub refused to mark the thread read. The thread stays unread and can be opened again. */
  markReadError: string | null;
}

const DEFAULT_REMEMBER_LIMIT = 200;

/**
 * Connects polling to delivery. It keeps only the items the user can still open,
 * in memory, and it turns mark-read failures into a reportable result.
 */
export class NotificationCenter {
  private readonly service: NotificationPort;
  private readonly isFocused: () => boolean;
  private readonly deliver: NotificationCenterOptions['deliver'];
  private readonly notify: NotificationCenterOptions['notify'];
  private readonly rememberLimit: number;
  private readonly items = new Map<string, NotificationItem>();

  constructor(options: NotificationCenterOptions) {
    this.service = options.service;
    this.isFocused = options.isFocused;
    this.deliver = options.deliver;
    this.notify = options.notify;
    this.rememberLimit = options.rememberLimit ?? DEFAULT_REMEMBER_LIMIT;
  }

  /** One background poll. Throws on failure so the refresh engine can back off. */
  async pollOnce(): Promise<{ pollIntervalMs?: number }> {
    const poll = await this.service.poll();
    if (poll.delivery) {
      if (poll.delivery.kind === 'items') {
        for (const item of poll.delivery.items) this.remember(item);
      }
      this.deliver(poll.delivery);
      for (const notice of desktopNotices(poll.delivery, this.isFocused())) this.notify(notice);
    }
    return poll.pollIntervalMs === undefined ? {} : { pollIntervalMs: poll.pollIntervalMs };
  }

  /** Marks the thread read and returns where it leads. A mark-read failure does not block navigation. */
  async open(threadId: string): Promise<NotificationOpenResult> {
    const item = this.items.get(threadId);
    if (!item) return { target: null, markReadError: null };
    try {
      await this.service.markRead(threadId);
      return { target: item.target, markReadError: null };
    } catch (error) {
      return {
        target: item.target,
        markReadError: error instanceof Error ? error.message : 'Could not mark the notification as read.'
      };
    }
  }

  private remember(item: NotificationItem): void {
    this.items.delete(item.threadId);
    this.items.set(item.threadId, item);
    while (this.items.size > this.rememberLimit) {
      const oldest = this.items.keys().next().value;
      if (oldest === undefined) break;
      this.items.delete(oldest);
    }
  }
}
