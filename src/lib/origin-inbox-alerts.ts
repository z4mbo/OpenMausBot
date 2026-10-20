import { useEffect, useRef } from "react";
import { cloudQueryOnce, useCloudQuery } from "./origin-cloud";
import { showOriginNotification } from "./notify";
import { useOpenOriginNotification, type OriginNotificationTarget } from "./origin-notification-open";
import { currentOriginPage, openOriginPage } from "./origin-pages";

export type InboxAlertRow = OriginNotificationTarget & {
  _id: string; kind: "assignment" | "comment" | "mention" | "digest" | "lead"; read: boolean; createdAt: number;
  actorName: string; preview?: string; taskTitle?: string; projectName?: string;
};

type Summary = { unread: number; more: boolean; latest: string | null };

const FRESH_MS = 120_000;

export function inboxAlert(row: InboxAlertRow): { tag: string; title: string; body: string } {
  if (row.kind === "digest") return { tag: row._id, title: `${row.actorName}'s standup${row.projectName ? ` for ${row.projectName}` : ""}`, body: row.preview || "Open your Origin inbox" };
  if (row.kind === "lead") return { tag: row._id, title: `${row.actorName} replied${row.projectName ? ` · ${row.projectName}` : ""}`, body: row.preview?.replace(/^[^:]*:\s*/, "") || "Open the lead in Pipeline" };
  const title = row.kind === "mention"
    ? `${row.actorName} tagged you${row.agentThreadId ? " in an agent thread" : row.messageId ? " in chat" : ""}`
    : row.kind === "comment" ? `${row.actorName} commented` : `${row.actorName} assigned you`;
  const where = row.projectName ? ` · ${row.projectName}` : "";
  return { tag: row._id, title, body: `${row.preview || row.taskTitle || ""}${where}`.replace(/^ · /, "").trim() || "Open your Origin inbox" };
}

/** Whether a new latest notification should raise a desktop alert: only one that just arrived and is still unread. */
export function freshAlert(row: InboxAlertRow | undefined, latest: string | null, now: number): row is InboxAlertRow {
  return Boolean(row && row._id === latest && !row.read && now - row.createdAt < FRESH_MS);
}

/** The workspace's unread notification count, raising a desktop alert for each one that arrives while this app runs. */
export function useOriginInboxAlerts(teamId: string | null): { unread: number; more: boolean } {
  const summary = useCloudQuery<Summary>("notifications:summary", teamId ? { teamId } : "skip");
  const open = useOpenOriginNotification();
  const opener = useRef(open);
  opener.current = open;
  const seen = useRef<{ teamId: string | null; latest: string | null } | null>(null);
  const latest = summary?.latest ?? null;
  const loaded = summary !== undefined;

  useEffect(() => {
    if (!teamId || !loaded) return;
    const previous = seen.current;
    seen.current = { teamId, latest };
    if (!previous || previous.teamId !== teamId || !latest || previous.latest === latest) return;
    void cloudQueryOnce<{ page: InboxAlertRow[] }>("notifications:list", { teamId, unreadOnly: true, paginationOpts: { numItems: 1, cursor: null } })
      .then(({ page }) => {
        const row = page[0];
        if (!freshAlert(row, latest, Date.now())) return;
        if (document.hasFocus() && currentOriginPage() === "inbox") return;
        showOriginNotification(inboxAlert(row), () => { if (row.kind === "digest") openOriginPage("inbox"); else opener.current(row); });
      })
      .catch(() => undefined);
  }, [teamId, latest, loaded]);

  return { unread: summary?.unread ?? 0, more: summary?.more ?? false };
}
