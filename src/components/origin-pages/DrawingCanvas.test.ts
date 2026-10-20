// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({ attach: vi.fn(), dispatch: vi.fn(), exportSvg: vi.fn(), png: vi.fn(), currentToken: "fixture-token", mutation: vi.fn(), rows: [] as string[] }));
vi.mock("./canvas/export", () => ({ exportSvg: fixture.exportSvg, svgToPng: fixture.png, download: vi.fn(), fileSafe: (name: string) => name }));
vi.mock("@/lib/origin-cloud", () => ({ cloudMutation: fixture.mutation, useCloudQuery: (name: string) => (name === "draw:scene" ? fixture.rows : name === "design:list" ? { assets: [], tokens: [] } : name === "pages:list" ? { pages: [], captureEnabled: false } : name === "brand:get" ? null : []), useCloudSession: () => ({ token: "fixture-token" }), useCloudUrl: () => "https://fixture.test" }));
vi.mock("@/lib/origin-cloud/client", () => ({ cloudUrl: () => "https://fixture.test", sessionStore: { get: () => fixture.currentToken } }));
vi.mock("@/state/store", () => ({ useStore: () => ({ dispatch: fixture.dispatch }) }));
vi.mock("@/lib/composer-attachments", () => ({ imageAttachmentFromFile: fixture.attach, composeMessage: (text: string) => text }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => false }));
vi.mock("../Avatar", () => ({ BotAvatar: () => null }));
vi.mock("../OriginPeople", () => ({ MemberAvatar: () => null, personTone: () => "green" }));
const { DrawingCanvas } = await import("./DrawingCanvas");
let host: HTMLDivElement;
let root: Root;
let mounted = false;
function mount(canvasId = "drawing", agent = false) {
  root = createRoot(host);
  mounted = true;
  flushSync(() => root.render(createElement(DrawingCanvas, { teamId: "team", canvasId, projectId: "project", userId: "user", name: "Fixture canvas", readOnly: false, agent: agent ? { id: "chief", name: "Atlas" } as Bot : undefined })));
}
function unmount() { if (mounted) { flushSync(() => root.unmount()); mounted = false; } }
const button = (name: string) => [...host.querySelectorAll("button")].find((element) => element.textContent?.includes(name) || element.getAttribute("aria-label") === name)!;
const saves = () => fixture.mutation.mock.calls.filter(([name]) => name === "draw:updateElements");
const addFrame = () => flushSync(() => button("Desktop").click());
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  fixture.rows = [];
  fixture.currentToken = "fixture-token";
  fixture.mutation.mockResolvedValue(null);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.createElement("div"); document.body.append(host);
});
afterEach(() => { unmount(); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("saves a new frame as a Canvas row", async () => {
  mount("frame-save");
  addFrame();
  await vi.advanceTimersByTimeAsync(200);
  const [row] = saves()[0][1].elements as string[];
  expect(JSON.parse(row)).toMatchObject({ format: "canvas", type: "frame", name: "Desktop", width: 1440, height: 1024, version: 1 });
});

it("recovers an in-flight edit after navigating away before its save fails", async () => {
  const save = Promise.withResolvers<null>();
  fixture.mutation.mockImplementation((name: string) => name === "draw:updateElements" ? save.promise : Promise.resolve(null));
  mount("failed-save");
  addFrame();
  await vi.advanceTimersByTimeAsync(200);
  expect(saves()).toHaveLength(1);
  const sent = saves()[0][1].elements;
  unmount();
  save.reject(new Error("Offline"));
  await vi.advanceTimersByTimeAsync(0);
  fixture.mutation.mockResolvedValue(null);
  mount("failed-save");
  await vi.advanceTimersByTimeAsync(1200);
  expect(saves().at(-1)?.[1].elements).toEqual(sent);
  expect(host.textContent).toContain("Desktop");
});

it("does not send a previous account's queued edits with a replacement session", async () => {
  mount("account-change");
  addFrame();
  fixture.currentToken = "replacement-token";
  await vi.advanceTimersByTimeAsync(400);
  expect(saves()).toEqual([]);
  expect(Object.keys(localStorage).some((key) => key.includes("account-change"))).toBe(true);
});

it("shows Excalidraw drawings from before Canvas as layers", async () => {
  fixture.rows = [JSON.stringify({ id: "old", type: "rectangle", version: 4, versionNonce: 2, x: 0, y: 0, width: 50, height: 40, strokeColor: "#1e1e1e", backgroundColor: "transparent" })];
  mount("legacy");
  await vi.advanceTimersByTimeAsync(0);
  expect(host.querySelector('[aria-label="Layers"]')?.textContent).toContain("Rectangle");
  expect(host.querySelector('[data-node-id="old"]')).not.toBeNull();
});

it("exports only one agent snapshot when submit events arrive before the busy render", () => {
  fixture.exportSvg.mockReturnValue(new Promise(() => {}));
  mount("ask-duplicate", true);
  flushSync(() => host.querySelector<HTMLButtonElement>('[aria-label="Ask Atlas"]')!.click());
  const form = host.querySelector<HTMLFormElement>('form[aria-label^="Ask"]')!;
  flushSync(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(fixture.exportSvg).toHaveBeenCalledOnce();
});

it("cancels a pending snapshot when its panel closes", async () => {
  const snapshot = Promise.withResolvers<unknown>(); fixture.exportSvg.mockReturnValue(snapshot.promise);
  mount("ask-cancel", true);
  flushSync(() => host.querySelector<HTMLButtonElement>('[aria-label="Ask Atlas"]')!.click());
  flushSync(() => host.querySelector('form[aria-label^="Ask"]')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  flushSync(() => host.querySelector<HTMLButtonElement>('[data-agent-panel] [aria-label="Close"]')!.click());
  snapshot.resolve({ svg: "<svg/>", width: 1, height: 1 }); await vi.advanceTimersByTimeAsync(0);
  expect(fixture.png).not.toHaveBeenCalled(); expect(fixture.dispatch).not.toHaveBeenCalled();
});

it("sends the selection's layers and a way to edit them to the Chief", async () => {
  fixture.exportSvg.mockResolvedValue({ svg: "<svg/>", width: 10, height: 10 });
  fixture.png.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  fixture.attach.mockResolvedValue({ kind: "image" });
  mount("ask-send", true);
  addFrame();
  flushSync(() => host.querySelector<HTMLButtonElement>('[aria-label="Ask Atlas"]')!.click());
  flushSync(() => host.querySelector('form[aria-label^="Ask"]')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await vi.advanceTimersByTimeAsync(0);
  const sent = fixture.dispatch.mock.calls.find(([action]) => action.type === "send")?.[0];
  expect(sent).toMatchObject({ botId: "chief" });
  expect(sent.text).toContain('"Desktop" on the shared "Fixture canvas" canvas (canvas ask-send)');
  expect(sent.text).toContain("origin_canvas_edit");
  expect(sent.text).toContain('"type":"frame"');
});
