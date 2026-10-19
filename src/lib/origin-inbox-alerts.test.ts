import { describe, expect, it } from "vitest";
import { freshAlert, inboxAlert, type InboxAlertRow } from "./origin-inbox-alerts";

const row = (fields: Partial<InboxAlertRow>): InboxAlertRow => ({ _id: "n1", kind: "mention", read: false, createdAt: 1_000, actorName: "Ana", available: true, ...fields });

describe("Origin inbox alerts", () => {
  it("says who tagged you and where", () => {
    expect(inboxAlert(row({ messageId: "m", conversation: "", preview: "@bo look" }))).toEqual({ tag: "n1", title: "Ana tagged you in chat", body: "@bo look" });
    expect(inboxAlert(row({ messageId: "m", agentThreadId: "t", preview: "@bo look", projectName: "Kai" })).title).toBe("Ana tagged you in an agent thread");
    expect(inboxAlert(row({ kind: "assignment", taskTitle: "Fix login", projectName: "Kai" }))).toMatchObject({ title: "Ana assigned you", body: "Fix login · Kai" });
    expect(inboxAlert(row({ kind: "comment", projectName: "Kai" })).body).toBe("Kai");
    expect(inboxAlert(row({})).body).toBe("Open your Origin inbox");
    expect(inboxAlert(row({ kind: "digest", actorName: "Ada", projectName: "Kai", preview: "1 blocker" }))).toEqual({ tag: "n1", title: "Ada's standup for Kai", body: "1 blocker" });
  });

  it("alerts only for the newest notification while it is unread and just arrived", () => {
    expect(freshAlert(row({}), "n1", 2_000)).toBe(true);
    expect(freshAlert(row({}), "n2", 2_000)).toBe(false);
    expect(freshAlert(row({ read: true }), "n1", 2_000)).toBe(false);
    expect(freshAlert(row({}), "n1", 1_000 + 121_000)).toBe(false);
    expect(freshAlert(undefined, "n1", 2_000)).toBe(false);
  });
});
