// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const cloud = vi.hoisted(() => ({ mutation: vi.fn() }));
vi.mock("@/lib/origin-cloud", () => ({ useCloudQuery: () => ({ assets: [], tokens: [] }), cloudMutation: cloud.mutation }));
vi.mock("./ui", async (original) => ({
  ...await original<typeof import("./ui")>(),
  CloudGate: ({ children }: { children(gate: { projectId: string; canEdit: boolean; project: { name: string } }): ReactNode }) => children({ projectId: "p", canEdit: true, project: { name: "Fixture" } }),
}));
const { AssetsPage } = await import("./AssetsPage");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("retries only the files a failed batch did not save", async () => {
  cloud.mutation.mockImplementation(async (name: string) => (name === "design:generateUploadUrl" ? "https://upload.example.test" : null));
  let uploads = 0;
  vi.stubGlobal("fetch", vi.fn(async () => (++uploads === 2 ? new Response("", { status: 500 }) : Response.json({ storageId: `s${uploads}` }))));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(AssetsPage, { cloudProjectId: "p", projectName: "Project" })));
  act(() => [...host.querySelectorAll("button")].find((button) => button.textContent === "Add asset")!.click());
  const picker = document.querySelector<HTMLInputElement>('input[aria-label="Asset files"]')!;
  Object.defineProperty(picker, "files", { configurable: true, value: [new File(["a"], "a.png", { type: "image/png" }), new File(["b"], "b.png", { type: "image/png" })] });
  act(() => { picker.dispatchEvent(new Event("change", { bubbles: true })); });
  const form = picker.closest("form")!;
  await act(async () => { form.requestSubmit(); });
  await act(async () => { form.requestSubmit(); });
  const created = cloud.mutation.mock.calls.filter(([name]) => name === "design:createAsset").map(([, args]) => (args as { name: string }).name);
  expect(created).toEqual(["a.png", "b.png"]);
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
