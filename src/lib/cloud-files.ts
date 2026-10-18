import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import type { CloudFilesBridge, CloudFilesState } from "../../electron/cloud-sync.mjs";

/** Files lives in this computer's own window: a companion connected to another computer has none. */
export function cloudFilesBridge(): CloudFilesBridge | undefined {
  return window.ogb?.remoteClient?.active ? undefined : window.ogb?.cloudAccount?.files;
}

/** Main's Files state, kept current; null until main answers (and when main can't). */
export function useCloudFiles(bridge: CloudFilesBridge | undefined) {
  const [snapshot, setSnapshot] = useState<{ bridge: CloudFilesBridge | undefined; state: CloudFilesState | null; loading: boolean; error: boolean }>({ bridge, state: null, loading: Boolean(bridge), error: false });
  const [attempt, setAttempt] = useState(0);
  const owner = useRef(bridge);
  owner.current = bridge;
  const setState = useCallback((next: SetStateAction<CloudFilesState | null>) => {
    if (owner.current !== bridge) return;
    setSnapshot((previous) => ({ bridge, state: typeof next === "function" ? next(previous.bridge === bridge ? previous.state : null) : next, loading: false, error: false }));
  }, [bridge]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (!bridge) return;
    let live = true, settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setSnapshot((previous) => ({ bridge, state: previous.bridge === bridge ? previous.state : null, loading: true, error: false }));
    const stopTimer = () => { if (timer !== undefined) clearTimeout(timer); };
    const fail = () => {
      if (!live || settled) return;
      settled = true; stopTimer();
      setSnapshot((previous) => ({ bridge, state: previous.bridge === bridge ? previous.state : null, loading: false, error: true }));
    };
    const off = bridge.onState((next) => {
      if (!live) return;
      settled = true; stopTimer();
      setSnapshot({ bridge, state: next, loading: false, error: false });
    });
    if (!settled) timer = setTimeout(fail, 10_000);
    void Promise.resolve().then(() => bridge.state()).then((next) => {
      if (!live || settled) return;
      settled = true; stopTimer();
      setSnapshot({ bridge, state: next, loading: false, error: false });
    }).catch(fail);
    return () => { live = false; stopTimer(); off(); };
  }, [bridge, attempt]);
  const current = snapshot.bridge === bridge ? snapshot : { state: null, loading: Boolean(bridge), error: false };
  return [current.state, setState, { loading: current.loading, error: current.error, retry }] as const;
}

/** The Files row shows only while main says this app has a Ready My Cloud (signed out or offline included). */
export function useCloudFilesReady(): boolean {
  const [state] = useCloudFiles(cloudFilesBridge());
  return state !== null && state.phase !== "unavailable";
}
