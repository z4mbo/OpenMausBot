import { describe, expect, it, vi } from "vitest";
import type { RequestAuth } from "../request-auth.ts";
import { createBrowserViewAccess } from "./browser-view-access.ts";

const member: RequestAuth = {
  kind: "session", via: "bearer", scopes: ["client"],
  session: {
    id: "fixture-member", tokenHash: "0".repeat(64), label: "Fixture member", scopes: ["client"],
    createdAt: 1, lastSeenAt: 1, expiresAt: Number.MAX_SAFE_INTEGER,
  },
};

function fixture(auth: RequestAuth = member) {
  const state = { visible: true, enabled: true, live: true, session: "fixture-browser", browser: true, exists: true };
  const visible = vi.fn(() => state.visible);
  const view = createBrowserViewAccess({
    auth, botId: "fixture-bot", session: "fixture-browser",
    bot: (id) => state.exists ? { id, browser: state.browser, browserProfile: "fixture-profile" } : null,
    enabled: () => state.enabled, sessionFor: () => state.session, isLive: () => state.live, visible,
  });
  return { state, visible, ...view };
}

describe("browser view access", () => {
  it("rechecks bot visibility while the browser and member session stay live", () => {
    const view = fixture();
    expect(view.owner).toBe("fixture-member");
    expect(view.isCurrent()).toBe(true);
    view.state.visible = false;
    expect(view.state.live).toBe(true);
    expect(view.state.session).toBe("fixture-browser");
    expect(view.isCurrent()).toBe(false);
  });

  it("rejects a view when visibility changed before initialization finished", () => {
    const view = fixture();
    view.state.visible = false;
    expect(view.isCurrent()).toBe(false);
  });

  it.each(["enabled", "live", "browser", "exists"] as const)("retains the %s gate", (field) => {
    const view = fixture();
    view.state[field] = false;
    expect(view.isCurrent()).toBe(false);
  });

  it("rejects a replaced browser session", () => {
    const view = fixture();
    view.state.session = "replacement-browser";
    expect(view.isCurrent()).toBe(false);
  });

  it("keeps the local owner's identity independent of paired sessions", () => {
    const view = fixture({ kind: "loopback", scopes: ["admin", "client"] });
    view.state.live = false;
    expect(view.owner).toBe("local-owner");
    expect(view.isCurrent()).toBe(true);
  });
});
