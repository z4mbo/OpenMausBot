// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const github = vi.hoisted(() => ({ workspace: vi.fn(), connection: vi.fn(async () => ({ connection: null })) }));
vi.mock("@/lib/origin-github", () => ({ originGitHub: github }));
vi.mock("@/lib/origin-cloud", () => ({ useCloudQuery: () => undefined, cloudMutation: vi.fn() }));
const { GitHubConnectionCard } = await import("./ProjectSettingsPage");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("offers a retry instead of loading forever when the GitHub status cannot be read", async () => {
  github.workspace.mockRejectedValueOnce(new Error("Server unreachable")).mockResolvedValueOnce({ configured: true, login: "ada" });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(GitHubConnectionCard, { project: { _id: "p", name: "Fixture", teamId: "t", memberRole: "owner" } as never, projectId: "p", isAdmin: true })));
  expect(host.textContent).toContain("Server unreachable");
  expect(host.querySelector('[role="status"][aria-live]')).toBeNull();
  await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Try again")!.click(); });
  expect(host.textContent).toContain("Connected as @ada");
  act(() => root.unmount());
});

it("keeps the newest GitHub status when an older read answers last", async () => {
  let answerOld!: (value: unknown) => void;
  github.workspace.mockReset().mockImplementationOnce(() => new Promise((resolve) => { answerOld = resolve; })).mockResolvedValueOnce({ configured: true, login: "new-account" });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(GitHubConnectionCard, { project: { _id: "p", name: "Fixture", teamId: "t", memberRole: "owner" } as never, projectId: "p", isAdmin: true })));
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await act(async () => { answerOld({ configured: true, login: "old-account" }); });
  expect(host.textContent).toContain("@new-account");
  act(() => root.unmount());
});
