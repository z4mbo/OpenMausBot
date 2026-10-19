// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ workspaceRole: "member" }));
vi.mock("@/lib/origin-cloud", () => ({
  useCloudUrl: () => "https://fixture.convex.cloud",
  useCloudSession: () => ({ ready: true, user: { _id: "user" }, token: "fixture" }),
  cloudMutation: vi.fn(),
  useCloudQuery: (name: string) => {
    if (name === "projects:get") return { _id: "project", teamId: "team", name: "Fixture", memberRole: "owner" };
    if (name === "workspaces:access") return { teamId: "team", slug: "team", role: fixture.workspaceRole };
    return [];
  },
}));
vi.mock("@/lib/origin-members", () => ({ useAppAddress: () => "https://fixture.example.test", feedbackLink: () => "https://fixture.example.test/feedback/fixture" }));
const { FeedbackPage } = await import("./FeedbackPage");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it.each([["member", false], ["admin", true], ["owner", true]] as const)("offers portal setup to a %s of the workspace: %s", (role, offered) => {
  fixture.workspaceRole = role;
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(createElement(FeedbackPage, { cloudProjectId: "project", projectName: "Fixture" })));
  expect(host.textContent!.includes("Set up feedback")).toBe(offered);
  act(() => root.unmount());
});
