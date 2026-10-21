import { useEffect, useMemo, type RefObject } from "react";
import type { Action, AppState, Message } from "./store";

export interface PendingThreadSnapshotTarget {
  botId: string;
  threadId: string;
  generation: number;
}

export interface PendingThreadSnapshotPage {
  messages: Message[];
  activeLeafId: string | null;
  hasMore?: boolean;
}

type PendingThreadSnapshotRequest = (path: string, init: { method: "GET"; signal: AbortSignal; timeoutMs: number }) => Promise<PendingThreadSnapshotPage>;
type PendingThreadSnapshotAction = Extract<Action, { type: "retryPendingThreadSnapshot" | "pendingThreadSnapshotLoaded" | "pendingThreadSnapshotFailed" }>;

export function bumpTranscriptGeneration(state: AppState, threadId: string | undefined | null): AppState {
  if (!threadId) return state;
  return {
    ...state,
    transcriptGeneration: {
      ...state.transcriptGeneration,
      [threadId]: (state.transcriptGeneration[threadId] ?? 0) + 1,
    },
  };
}

export function hydratedTranscriptState(
  state: AppState,
  incoming: Pick<AppState, "bots" | "groups">,
): Pick<AppState, "backgroundThreadEvents" | "loadingOlder" | "transcriptGeneration"> {
  return {
    backgroundThreadEvents: {},
    loadingOlder: {},
    transcriptGeneration: Object.fromEntries([...new Set([
      ...Object.keys(state.transcriptGeneration), ...state.bots.map((bot) => bot.threadId),
      ...state.groups.map((group) => group.threadId), ...incoming.bots.map((bot) => bot.threadId),
      ...incoming.groups.map((group) => group.threadId),
    ])].map((threadId) => [threadId, (state.transcriptGeneration[threadId] ?? 0) + 1])),
  };
}

export function pendingThreadSnapshotTarget(state: AppState, botId: string): PendingThreadSnapshotTarget | undefined {
  const bot = state.bots.find((candidate) => candidate.id === botId);
  if (!bot?.awaitingThreadSnapshot || bot.switchingTo || state.deletingBots[bot.id] ||
      !bot.tasks?.some((task) => task.threadId === bot.threadId)) return;
  return { botId: bot.id, threadId: bot.threadId, generation: state.transcriptGeneration[bot.threadId] ?? 0 };
}

function sameTarget(left: PendingThreadSnapshotTarget | undefined, right: PendingThreadSnapshotTarget | undefined): boolean {
  return left?.botId === right?.botId && left?.threadId === right?.threadId && left?.generation === right?.generation;
}

export function reducePendingThreadSnapshot(state: AppState, action: PendingThreadSnapshotAction, reduce: (state: AppState, action: Action) => AppState): AppState {
  const target = pendingThreadSnapshotTarget(state, action.botId);
  if (action.type === "retryPendingThreadSnapshot") {
    return target?.threadId === action.threadId ? bumpTranscriptGeneration(state, target.threadId) : state;
  }
  if (!target || target.botId !== action.botId || target.threadId !== action.threadId || target.generation !== action.generation) return state;
  if (action.type === "pendingThreadSnapshotFailed") return { ...state, error: action.message };
  const bot = state.bots.find((candidate) => candidate.id === target.botId)!;
  return reduce(state, { type: "taskSwitched", bot: { ...bot, ...action.page } });
}

export function createPendingThreadSnapshotRecovery({ getState, request, dispatch }: {
  getState(): AppState;
  request: PendingThreadSnapshotRequest;
  dispatch(action: Action): void;
}) {
  const pending = new Map<string, { target: PendingThreadSnapshotTarget; controller: AbortController; settled: boolean }>();
  function reconcile() {
    const state = getState();
    const targets = new Map(state.bots.flatMap((bot) => {
      if (!bot.awaitingThreadSnapshot) return [];
      const target = pendingThreadSnapshotTarget(state, bot.id);
      return target ? [[bot.id, target] as const] : [];
    }));
    for (const [botId, current] of pending) {
      if (sameTarget(targets.get(botId), current.target)) continue;
      current.controller.abort();
      pending.delete(botId);
    }
    let inFlight = [...pending.values()].filter((current) => !current.settled).length;
    for (const [botId, target] of targets) {
      if (pending.has(botId) || inFlight >= 4) continue;
      const current = { target, controller: new AbortController(), settled: false };
      pending.set(botId, current);
      inFlight += 1;
      const accepts = () => pending.get(botId) === current && !current.controller.signal.aborted &&
        sameTarget(target, pendingThreadSnapshotTarget(getState(), botId));
      void request(`/api/threads/${encodeURIComponent(target.threadId)}/messages?limit=200`, {
        method: "GET", signal: current.controller.signal, timeoutMs: 15_000,
      }).then((page) => {
        if (!accepts()) return;
        if (!Array.isArray(page.messages) || (page.activeLeafId !== null && typeof page.activeLeafId !== "string") ||
            (page.hasMore !== undefined && typeof page.hasMore !== "boolean")) throw new Error("Invalid conversation snapshot");
        dispatch({ type: "pendingThreadSnapshotLoaded", ...target, page });
      }).catch((error: unknown) => {
        if (accepts()) dispatch({ type: "pendingThreadSnapshotFailed", ...target, message: error instanceof Error ? error.message : String(error) });
      }).finally(() => {
        current.settled = true;
        if (pending.get(botId) === current) reconcile();
      });
    }
  }
  return {
    reconcile,
    dispose() {
      for (const current of pending.values()) current.controller.abort();
      pending.clear();
    },
  };
}

export function usePendingThreadSnapshotRecovery(
  state: AppState,
  stateRef: RefObject<AppState>,
  request: PendingThreadSnapshotRequest,
  dispatch: (action: Action) => void,
) {
  const pendingThreadSnapshots = useMemo(() => createPendingThreadSnapshotRecovery({
    getState: () => stateRef.current,
    request,
    dispatch,
  }), []);
  useEffect(() => {
    pendingThreadSnapshots.reconcile();
  }, [pendingThreadSnapshots, state.bots, state.selectedId, state.activeView, state.transcriptGeneration, state.deletingBots]);
  useEffect(() => () => pendingThreadSnapshots.dispose(), [pendingThreadSnapshots]);
}
