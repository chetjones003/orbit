import { describeItem, describeSummary, type NotificationDelivery } from '../shared/notifications';

/** One desktop notification. `threadId` is null for summaries, which open the app without navigating. */
export interface DesktopNotice {
  threadId: string | null;
  title: string;
  body: string;
}

/**
 * Desktop notifications for a delivery. They appear only while Orbit is not
 * focused: a focused window shows animated toasts instead. The quiet startup
 * baseline never becomes a desktop notification.
 */
export function desktopNotices(delivery: NotificationDelivery, focused: boolean): DesktopNotice[] {
  if (focused) return [];
  if (delivery.kind === 'summary') {
    if (!delivery.desktop) return [];
    return [{ threadId: null, ...describeSummary(delivery.count, false) }];
  }
  return delivery.items.map((item) => ({ threadId: item.threadId, ...describeItem(item) }));
}
