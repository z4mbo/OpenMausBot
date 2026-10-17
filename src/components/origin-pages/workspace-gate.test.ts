import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const cloud = vi.hoisted(() => ({ url: "https://example.convex.cloud" as string | null, signedIn: false, role: undefined as string | undefined }));

vi.mock("@/lib/origin-cloud", () => ({
  useCloudUrl: () => cloud.url,
  useCloudSession: () => ({
    user: cloud.signedIn ? { _id: "u1", email: "a@example.com" } : null,
    token: cloud.signedIn ? "t" : null,
    ready: true,
    login: async () => {},
    logout: async () => {},
  }),
  useCloudQuery: () => undefined,
}));
vi.mock("@/lib/origin-members", () => ({
  useWorkspaceAccess: (teamId: string | null) => (teamId && cloud.role ? { teamId, slug: "w", role: cloud.role } : undefined),
}));

const { WorkspaceGate } = await import("./ui");
const render = (teamId: string | null) => renderToStaticMarkup(createElement(WorkspaceGate, {
  teamId, label: "Inbox",
  children: (ctx) => createElement("p", null, `team ${ctx.teamId} as ${ctx.role}, ${ctx.canEdit ? "can edit" : "view only"}`),
}));

describe("WorkspaceGate", () => {
  it("asks to sign in before anything else", () => {
    cloud.signedIn = false;
    expect(render("t1")).toContain("Sign in to Origin");
    expect(render(null)).toContain("Sign in to Origin");
  });

  it("asks to link a workspace that has no Origin workspace", () => {
    cloud.signedIn = true;
    expect(render(null)).toContain("Connect this workspace to Origin");
  });

  it("waits for the member's access, then hands over the workspace", () => {
    cloud.signedIn = true;
    cloud.role = undefined;
    expect(render("t1")).toContain('role="status"');
    cloud.role = "member";
    expect(render("t1")).toContain("team t1 as member, can edit");
    cloud.role = "viewer";
    expect(render("t1")).toContain("view only");
  });

  it("says when Origin has no address", () => {
    cloud.url = null;
    expect(render("t1")).toContain("Origin is not set up");
    cloud.url = "https://example.convex.cloud";
  });
});
