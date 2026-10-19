// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudFilesBridge, CloudFilesState } from "../../electron/cloud-sync.mjs";
import { useCloudFiles } from "./cloud-files";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = (time: number): CloudFilesState => ({ phase: "idle", lastSyncedAt: time, disk: null, shared: [], outputs: { enabled: false, dir: "C:\\Fixture", folders: 0, problem: null } });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  let push!: (next: CloudFilesState) => void;
  const off = vi.fn(), read = vi.fn<() => Promise<CloudFilesState>>();
  const bridge: CloudFilesBridge = {
    state: read, onState: (callback: typeof push) => { push = callback; return off; },
    pickFolder: async () => null, checkFolders: async () => [], share: async () => state(0), stopSharing: async () => state(0),
    answerDeletes: async () => state(0), locate: async () => state(0), setOutputs: async () => state(0), open: async () => {}, moreSpace: async () => {},
  };
  return { bridge, read, off, push: (next: CloudFilesState) => push(next) };
}
let host: HTMLDivElement, root: Root, value: ReturnType<typeof useCloudFiles>;
function Probe({ bridge }: { bridge?: CloudFilesBridge }) { value = useCloudFiles(bridge); return null; }
const mount = (bridge?: CloudFilesBridge) => act(async () => root.render(createElement(Probe, { bridge })));
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

describe("Files preload state ownership and recovery", () => {
  it("exposes initial rejection and retries successfully", async () => {
    const f = fixture(); f.read.mockRejectedValueOnce(new Error("Synthetic IPC failure")).mockResolvedValue(state(2));
    await mount(f.bridge); expect(value[2]).toMatchObject({ loading: false, error: true });
    await act(async () => value[2].retry());
    expect(value[0]?.lastSyncedAt).toBe(2); expect(value[2]).toMatchObject({ loading: false, error: false });
  });

  it("bounds a silent IPC request and ignores its late reply after Retry", async () => {
    vi.useFakeTimers(); const f = fixture(), first = deferred<CloudFilesState>();
    f.read.mockReturnValueOnce(first.promise).mockResolvedValue(state(2));
    await mount(f.bridge); expect(value[2].loading).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(10_000)); expect(value[2].error).toBe(true);
    await act(async () => value[2].retry()); expect(value[0]?.lastSyncedAt).toBe(2);
    await act(async () => first.resolve(state(1))); expect(value[0]?.lastSyncedAt).toBe(2);
  });

  it("keeps a pushed state ahead of the outstanding initial pull and its failure", async () => {
    const f = fixture(), first = deferred<CloudFilesState>(); f.read.mockReturnValue(first.promise);
    await mount(f.bridge); await act(async () => f.push(state(3)));
    await act(async () => first.reject(new Error("Old pull failed")));
    expect(value[0]?.lastSyncedAt).toBe(3); expect(value[2].error).toBe(false);
  });

  it("recovers from timeout when main pushes a usable state", async () => {
    vi.useFakeTimers(); const f = fixture(); f.read.mockReturnValue(new Promise(() => {}));
    await mount(f.bridge); await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(value[2].error).toBe(true); await act(async () => f.push(state(4)));
    expect(value[0]?.lastSyncedAt).toBe(4); expect(value[2]).toMatchObject({ loading: false, error: false });
  });

  it("retains already loaded data if an explicit refresh fails", async () => {
    const f = fixture(); f.read.mockResolvedValueOnce(state(1)).mockRejectedValueOnce(new Error("Refresh failed"));
    await mount(f.bridge); await act(async () => value[2].retry());
    expect(value[0]?.lastSyncedAt).toBe(1); expect(value[2].error).toBe(true);
  });

  it("rejects old bridge replies, pushes and mutation setters after ownership changes", async () => {
    const old = fixture(), current = fixture(), pending = deferred<CloudFilesState>();
    old.read.mockReturnValue(pending.promise); current.read.mockResolvedValue(state(9));
    await mount(old.bridge); const oldSetter = value[1]; await mount(current.bridge);
    await act(async () => { old.push(state(1)); oldSetter(state(2)); pending.resolve(state(3)); });
    expect(value[0]?.lastSyncedAt).toBe(9); expect(old.off).toHaveBeenCalledOnce();
  });

  it("clears its pending timeout and subscription when unmounted", async () => {
    vi.useFakeTimers(); const f = fixture(); f.read.mockReturnValue(new Promise(() => {}));
    await mount(f.bridge); expect(vi.getTimerCount()).toBe(1);
    act(() => root.unmount()); expect(vi.getTimerCount()).toBe(0); expect(f.off).toHaveBeenCalledOnce();
  });
});
