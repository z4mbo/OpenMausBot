// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({ attach: vi.fn(), dispatch: vi.fn(), export: vi.fn(), currentToken: "fixture-token", mutation: vi.fn(), change: null as null | ((...args: any[]) => void), api: { getSceneElements: vi.fn(() => [{ id: "shape", type: "rectangle" }]), getSceneElementsIncludingDeleted: vi.fn(() => []), getFiles: vi.fn(() => ({})), getAppState: vi.fn(() => ({})), updateScene: vi.fn(), addFiles: vi.fn() }, files: [] as unknown[] }));
vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: (props: any) => { fixture.change = props.onChange; return createElement("button", { onClick: () => { props.excalidrawAPI(fixture.api); props.onChange([], { isLoading: false }, {}); } }, "Initialize drawing"); },
  CaptureUpdateAction: { NEVER: "never" }, restoreElements: (rows: unknown[]) => rows, reconcileElements: (local: unknown[], remote: unknown[]) => [...local, ...remote], exportToBlob: fixture.export,
}));
vi.mock("@/lib/origin-cloud", () => ({ cloudMutation: fixture.mutation, useCloudQuery: (name: string) => name === "draw:files" ? fixture.files : [], useCloudSession: () => ({ token: "fixture-token" }), useCloudUrl: () => "https://fixture.test" }));
vi.mock("@/lib/origin-cloud/client", () => ({ cloudUrl: () => "https://fixture.test", sessionStore: { get: () => fixture.currentToken } }));
vi.mock("@/lib/color-scheme", () => ({ useColorScheme: () => "dark" }));
vi.mock("@/state/store", () => ({ useStore: () => ({ dispatch: fixture.dispatch }) }));
vi.mock("@/lib/composer-attachments", () => ({ imageAttachmentFromFile: fixture.attach, composeMessage: (text: string) => text }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => false }));
vi.mock("../Avatar", () => ({ BotAvatar: () => null }));
vi.mock("../OriginPeople", () => ({ MemberAvatar: () => null, personTone: () => "green" }));
vi.mock("./ui", () => ({ Loading: () => null, Notice: () => null, iconButton: "", inputClass: "", primaryButton: "" }));
const { DrawingCanvas } = await import("./DrawingCanvas");
let host: HTMLDivElement;
let root: Root;
let mounted = false;
function mount(canvasId = "drawing", agent = false) {
  root = createRoot(host);
  mounted = true;
  flushSync(() => root.render(createElement(DrawingCanvas, { teamId: "team", canvasId, userId: "user", name: "Fixture drawing", readOnly: false, agent: agent ? { id: "chief", name: "Atlas" } as Bot : undefined })));
  flushSync(() => host.querySelector("button")!.click());
}
function unmount() { if (mounted) { flushSync(() => root.unmount()); mounted = false; } }
const shape = { id: "rectangle", type: "rectangle", version: 1, versionNonce: 1, x: 10, y: 10, width: 100, height: 60 };
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  fixture.files = [];
  fixture.currentToken = "fixture-token";
  fixture.mutation.mockResolvedValue(null);
  host = document.createElement("div"); document.body.append(host);
});
afterEach(() => { unmount(); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("recovers an in-flight edit after navigating away before its save fails", async () => {
  const save = Promise.withResolvers<null>();
  fixture.mutation.mockImplementation((name: string) => name === "draw:updateElements" ? save.promise : Promise.resolve(null));
  mount("failed-save");
  flushSync(() => fixture.change!([shape], {}, {}));
  await vi.advanceTimersByTimeAsync(200);
  expect(fixture.mutation.mock.calls.filter(([name]) => name === "draw:updateElements")).toHaveLength(1);
  unmount();
  save.reject(new Error("Offline"));
  await vi.advanceTimersByTimeAsync(0);
  fixture.mutation.mockResolvedValue(null);
  mount("failed-save");
  await vi.advanceTimersByTimeAsync(1200);
  expect(fixture.mutation.mock.calls.filter(([name]) => name === "draw:updateElements").at(-1)?.[1].elements).toEqual([JSON.stringify(shape)]);
  expect(fixture.mutation.mock.calls.filter(([name]) => name === "draw:updateElements").length).toBeGreaterThan(1);
});

it("does not apply an image download after leaving its canvas", async () => {
  const image = Promise.withResolvers<Response>();
  fixture.files = [{ fileId: "image", mimeType: "image/png", url: "https://fixture.test/image" }];
  const request = vi.fn(() => image.promise);
  vi.stubGlobal("fetch", request);
  mount("stale-image");
  unmount();
  expect((request.mock.calls[0] as unknown as [string, RequestInit])[1]?.signal?.aborted).toBe(true);
  image.resolve(new Response(new Blob(["fixture"], { type: "image/png" })));
  await vi.advanceTimersByTimeAsync(100);
  expect(fixture.api.addFiles).not.toHaveBeenCalled();
});

it("does not send a previous account's queued edits with a replacement session", async () => {
  mount("account-change");
  flushSync(() => fixture.change!([shape], {}, {}));
  fixture.currentToken = "replacement-token";
  await vi.advanceTimersByTimeAsync(400);
  expect(fixture.mutation.mock.calls.filter(([name]) => name === "draw:updateElements")).toEqual([]);
  expect(Object.keys(localStorage).some((key) => key.includes("account-change"))).toBe(true);
});

it("abandons an upload URL when its account changes before the URL arrives", async () => {
  const url = Promise.withResolvers<string>();
  fixture.mutation.mockImplementation((name: string) => name === "draw:uploadUrl" ? url.promise : Promise.resolve(null));
  const request = vi.fn(); vi.stubGlobal("fetch", request);
  mount("upload-account-change");
  flushSync(() => fixture.change!([], {}, { image: { id: "image", mimeType: "image/png", dataURL: "data:image/png;base64,YQ==", created: 1 } }));
  await vi.advanceTimersByTimeAsync(200);
  expect(fixture.mutation.mock.calls.some(([name]) => name === "draw:uploadUrl")).toBe(true);
  fixture.currentToken = "replacement-token";
  url.resolve("https://fixture.test/upload");
  await vi.advanceTimersByTimeAsync(0);
  expect(request).not.toHaveBeenCalled();
  expect(fixture.mutation.mock.calls.some(([name]) => name === "draw:saveFile")).toBe(false);
});

