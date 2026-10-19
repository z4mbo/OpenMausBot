// @vitest-environment happy-dom
import { createElement, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const cloud = vi.hoisted(() => ({ userId: "one", url: "https://fixture.convex.cloud" }));
vi.mock("@/lib/origin-cloud", () => ({
  useCloudUrl: () => cloud.url,
  useCloudSession: () => ({ ready: true, user: { _id: cloud.userId, email: "fixture@example.test" }, token: "fixture", login: vi.fn() }),
  useCloudQuery: (_name: string, args: { projectId: string }) => ({ _id: args.projectId, memberRole: "owner" }),
}));
vi.mock("@/lib/origin-members", () => ({ useWorkspaceAccess: () => ({ role: "owner" }) }));
const { CloudGate, WorkspaceGate } = await import("./ui");
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
afterEach(() => { flushSync(() => root.unmount()); host.replaceChildren(); root = createRoot(host); cloud.userId = "one"; cloud.url = "https://fixture.convex.cloud"; });
function Draft() {
  const [value, setValue] = useState("locked");
  return createElement("button", { onClick: () => setValue("secret from previous scope") }, value);
}
describe("Origin gate state ownership", () => {
  it.each(["project", "workspace"])("resets %s state when its scope changes", (kind) => {
    const render = (id: string) => flushSync(() => root.render(kind === "project"
      ? createElement(CloudGate, { cloudProjectId: id, projectName: id, label: "Vault", children: () => createElement(Draft) })
      : createElement(WorkspaceGate, { teamId: id, label: "Chat", children: () => createElement(Draft) })));
    render("first");
    flushSync(() => host.querySelector("button")!.click());
    expect(host.textContent).toBe("secret from previous scope");
    render("second");
    expect(host.textContent).toBe("locked");
  });
  it.each(["account", "server"])("resets private project state on %s change", (kind) => {
    const render = () => flushSync(() => root.render(createElement(CloudGate, { cloudProjectId: "first", projectName: "Fixture", label: "Vault", children: () => createElement(Draft) })));
    render();
    flushSync(() => host.querySelector("button")!.click());
    if (kind === "account") cloud.userId = "two";
    else cloud.url = "https://other-fixture.convex.cloud";
    render();
    expect(host.textContent).toBe("locked");
  });
});
