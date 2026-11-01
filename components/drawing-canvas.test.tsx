// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { FunctionReference } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";

type CanvasProps = { excalidrawAPI: (api: object) => void; onChange: (elements: object[], state: { isLoading: boolean }, files: object) => void };
const f = vi.hoisted(() => ({
  onChange: undefined as CanvasProps["onChange"] | undefined,
  update: vi.fn(), presence: vi.fn(),
  rows: [] as { userId: string; name: string; x: number; y: number; button: string; updatedAt: number }[],
  scene: [] as string[], files: [] as object[],
  canvas: { getSceneElementsIncludingDeleted: () => [], getAppState: () => ({}), updateScene: vi.fn(), getFiles: () => ({}), addFiles: vi.fn() },
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: FunctionReference<"query">) => getFunctionName(ref) === "draw:presence" ? f.rows : getFunctionName(ref) === "draw:files" ? f.files : getFunctionName(ref) === "workspaces:members" ? [] : f.scene,
  useMutation: (ref: FunctionReference<"mutation">) => getFunctionName(ref) === "draw:updateElements" ? f.update : f.presence,
}));
vi.mock("./workspace-context", () => ({ useWorkspace: () => ({ _id: "team", name: "PG2", role: "member" }) }));
vi.mock("./workspace-connection", () => ({ useWorkspaceOnline: () => true }));
vi.mock("@excalidraw/excalidraw", () => ({
  MainMenu: Object.assign(() => null, { DefaultItems: new Proxy({}, { get: () => () => null }) }),
  CaptureUpdateAction: { NEVER: "never" }, restoreElements: (elements: object[]) => elements, reconcileElements: (_current: object[], incoming: object[]) => incoming,
  Excalidraw: (props: CanvasProps) => {
    f.onChange = props.onChange;
    useEffect(() => { props.excalidrawAPI(f.canvas); props.onChange([], { isLoading: false }, {}); }, [props.excalidrawAPI]);
    return null;
  },
}));
import DrawingCanvas from "./drawing-canvas";

const host = document.createElement("div");
document.body.append(host);
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); host.textContent = ""; f.rows = []; f.files = []; });
async function mount(readOnly = false) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  root ??= createRoot(host);
  await act(async () => root!.render(createElement(DrawingCanvas, { sessionToken: "pg2", user: { _id: "me", name: "PG2" }, canvasId: "canvas" as Id<"canvases">, readOnly })));
}
const element = { id: "shape", version: 1, versionNonce: 1, type: "rectangle", x: 1, y: 1, width: 20, height: 20 };

test("failed image loads remain visible across successful autosaves and clear after a successful retry", async () => {
  vi.useFakeTimers(); f.update.mockResolvedValue(null); f.presence.mockResolvedValue(null);
  const fetchImage = vi.fn().mockResolvedValue({ ok: false });
  vi.stubGlobal("fetch", fetchImage);
  f.files = [{ fileId: "image", mimeType: "image/png", url: "https://example.test/image.png" }];
  await mount();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("A drawing image could not be loaded");
  await act(async () => { f.onChange!([element], { isLoading: false }, {}); await vi.advanceTimersByTimeAsync(200); });
  expect(f.update).toHaveBeenCalledOnce();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("A drawing image could not be loaded");
  fetchImage.mockResolvedValue({ ok: true, blob: async () => new window.Blob(["fixture image"], { type: "image/png" }) });
  f.files = [...f.files];
  await mount();
  await act(async () => { await vi.waitFor(() => expect(f.canvas.addFiles).toHaveBeenCalledOnce()); });
  expect(f.canvas.addFiles).toHaveBeenCalledOnce();
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

test("PG2 O-090: rejected drawing save retains unload protection, retries and respects read-only", async () => {
  vi.useFakeTimers(); f.update.mockRejectedValueOnce(new Error("PG2 save unavailable")).mockResolvedValue(null); f.presence.mockResolvedValue(null);
  await mount();
  await act(async () => { f.onChange!([element], { isLoading: false }, {}); await vi.advanceTimersByTimeAsync(200); });
  expect(host.textContent).toContain("PG2 save unavailable");
  expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
  expect(f.update).toHaveBeenCalledTimes(2);
  expect(JSON.parse(f.update.mock.calls[1][0].elements[0])).toEqual(element);
  expect(host.textContent).not.toContain("PG2 save unavailable");
  expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(true);
  await mount(true);
  await act(async () => { f.onChange!([{ ...element, version: 2 }], { isLoading: false }, {}); await vi.advanceTimersByTimeAsync(2000); });
  expect(f.update).toHaveBeenCalledTimes(2);
});

test("PG2 O-087: remote cursor coordinates reach Excalidraw and expire after 30 seconds", async () => {
  vi.useFakeTimers(); f.presence.mockResolvedValue(null);
  f.rows = [{ userId: "peer", name: "Peer", x: 120, y: 240, button: "down", updatedAt: Date.now() }];
  await mount();
  expect(f.canvas.updateScene.mock.calls.some(([state]) => state.collaborators?.get("peer")?.pointer.x === 120)).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(40000); });
  const states = f.canvas.updateScene.mock.calls.map(([state]) => state).filter(state => state.collaborators);
  expect(states.at(-1)?.collaborators.size).toBe(0);
});
