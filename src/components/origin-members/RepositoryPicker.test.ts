// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { RepositoryChoice } from "@/lib/origin-project-access";

vi.mock("@/lib/origin-github", () => ({ originGitHub: { workspace: async () => ({ login: "fixture" }), repositories: async () => ({ repositories: [] }) } }));
const { RepositoryPicker } = await import("./RepositoryPicker");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let choice: RepositoryChoice = { mode: "existing", url: "" };
function Harness() {
  const [value, setValue] = useState<RepositoryChoice>(choice);
  choice = value;
  return createElement(RepositoryPicker, { teamId: "team", projectName: "Project", value, onChange: setValue });
}

it("keeps a pasted repository chosen after a detour through Later", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(createElement(Harness)));
  const search = host.querySelector<HTMLInputElement>('input[aria-label="Search or paste a repository"]')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "fixture/app"); search.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(choice).toEqual({ mode: "existing", url: "https://github.com/fixture/app" });
  await act(async () => host.querySelector<HTMLInputElement>('input[aria-label="Later"]')!.click());
  await act(async () => host.querySelector<HTMLInputElement>('input[aria-label="Use existing"]')!.click());
  expect(choice).toEqual({ mode: "existing", url: "https://github.com/fixture/app" });
  act(() => root.unmount());
});
