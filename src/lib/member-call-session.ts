import { useSyncExternalStore } from "react";
import type { CloudUser } from "./origin-cloud";
import type { RealtimeTarget } from "./origin-realtime";

/** How the person chose to join: the lobby's toggles and devices. */
export type MemberCallMedia = { audioEnabled: boolean; videoEnabled: boolean; audioDevice: string; videoDevice: string };

/**
 * The call the person is in, kept by one host for the whole app so changing page never drops it.
 * `agentId` is the one agent the call may bring in; `open` returns to the call's page.
 */
export type MemberCallConfig = {
  key: string;
  nonce: number;
  target: RealtimeTarget;
  me: CloudUser;
  name: string;
  agentId?: string;
  media: MemberCallMedia;
  open(): void;
};

export const memberCallKey = (target: RealtimeTarget) => `${target.teamId}:${target.room ?? ""}`;

type Listener = () => void;

function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

const configStore = store<MemberCallConfig | null>(null);
const stateStore = store<unknown>(null);
const visibleStore = store<string | null>(null);
const failureStore = store<{ key: string; message: string } | null>(null);
let nonce = 0;

/** Joins the call `config` describes, leaving any other one first. */
export function startMemberCall(config: Omit<MemberCallConfig, "nonce">): void {
  failureStore.set(null);
  stateStore.set(null);
  configStore.set({ ...config, nonce: ++nonce });
}

/** Drops the session; the host's engine leaves the room as it unmounts. */
export function endMemberCall(expectedNonce: number, failure?: { key: string; message: string }): void {
  if (configStore.get()?.nonce !== expectedNonce) return;
  configStore.set(null);
  stateStore.set(null);
  if (failure) failureStore.set(failure);
}

export const currentMemberCall = (): MemberCallConfig | null => configStore.get();

export function useMemberCallConfig(): MemberCallConfig | null {
  return useSyncExternalStore(configStore.subscribe, configStore.get, () => null);
}

/** The engine publishes its live state here every render, for the call page and the sidebar banner. */
export function publishMemberCallState(state: unknown, expectedNonce: number): void {
  if (configStore.get()?.nonce !== expectedNonce) return;
  stateStore.set(state);
}

export function useMemberCallState<T>(): T | null {
  return useSyncExternalStore(stateStore.subscribe, stateStore.get, () => null) as T | null;
}

export function useMemberCallFailure(key: string): string {
  const failure = useSyncExternalStore(failureStore.subscribe, failureStore.get, () => null);
  return failure?.key === key ? failure.message : "";
}

/** Which call's page is on screen, so the sidebar banner hides while the call itself is visible. */
export function showingCallPage(key: string | null): void {
  visibleStore.set(key);
}

export function useVisibleCallPage(): string | null {
  return useSyncExternalStore(visibleStore.subscribe, visibleStore.get, () => null);
}
