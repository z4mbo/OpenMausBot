import type { NotificationLogEntry } from "../../shared/notification";

export const NOTIFICATION_FEED_LIMIT = 500;

export type NotificationFeedAction =
  /** `resync` takes the server's read state as it is, to undo a read the server refused. */
  | { type: "notificationsHydrated"; notifications: NotificationLogEntry[]; resync?: boolean }
  | { type: "notificationReceived"; entry: NotificationLogEntry }
  | { type: "notificationRead"; id: string }
  | { type: "notificationsMarkAllRead" };

/** Newest first. Hydration takes the server's copy of each entry it returns and keeps live entries it has not seen yet; an entry read here stays read, because a load that started before the read cannot know of it. */
export function reduceNotificationFeed(feed: NotificationLogEntry[], action: NotificationFeedAction): NotificationLogEntry[] {
  switch (action.type) {
    case "notificationsHydrated": {
      const served = new Set(action.notifications.map((entry) => entry.id));
      const readHere = new Set(action.resync ? [] : feed.filter((entry) => entry.read).map((entry) => entry.id));
      const incoming = action.notifications.map((entry) => !entry.read && readHere.has(entry.id) ? { ...entry, read: true } : entry);
      return [...feed.filter((entry) => !served.has(entry.id)), ...incoming]
        .sort((a, b) => b.at - a.at)
        .slice(0, NOTIFICATION_FEED_LIMIT);
    }
    case "notificationReceived":
      return feed.some((entry) => entry.id === action.entry.id) ? feed : [action.entry, ...feed].slice(0, NOTIFICATION_FEED_LIMIT);
    case "notificationRead":
      return feed.map((entry) => (entry.id === action.id && !entry.read ? { ...entry, read: true } : entry));
    case "notificationsMarkAllRead":
      return feed.map((entry) => (entry.read ? entry : { ...entry, read: true }));
  }
}
