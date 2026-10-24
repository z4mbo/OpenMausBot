// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

let mounts = 0;
function Page({ projectName }: { projectName: string }) {
  const [first] = useState(() => { mounts += 1; return projectName; });
  return createElement("p", null, `${first} page shown for ${projectName}`);
}
vi.mock("./origin-pages", () => ({ IssuesPage: Page, AssetsPage: Page, VaultPage: Page, RepoPage: Page, FeedbackPage: Page, ProjectSettingsPage: Page, CallPage: Page, TeamChatPage: Page, AssignIssueDialog: () => null, implementBrief: () => "", issueBrief: () => "" }));
vi.mock("./OriginDraw", () => ({ ProjectDrawPage: () => null }));
vi.mock("./origin-studio/StudioPage", () => ({ StudioPage: () => null }));
vi.mock("./origin-broadcast/BroadcastPage", () => ({ BroadcastPage: () => null }));
vi.mock("./ProjectSectionBar", () => ({ ChiefSectionBar: () => null }));
vi.mock("@/lib/origin-cloud-links", () => ({ useCloudProjectFor: () => undefined, useCloudWorkspaceFor: () => undefined }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: { bots: [] }, dispatch: vi.fn() }) }));
const { ChiefSectionFrame } = await import("./ChiefSections");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("starts a fresh page when another project opens on the same section", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const show = (id: string, name: string) => act(() => root.render(createElement(ChiefSectionFrame, { bot: { id, name } as never, section: "issues", onSection() {} })));
  show("alpha", "Alpha");
  show("beta", "Beta");
  expect(host.textContent).toContain("Beta page shown for Beta");
  expect(mounts).toBe(2);
  act(() => root.unmount());
});
