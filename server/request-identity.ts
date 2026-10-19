import type { ResolvedSender } from "../shared/wire.ts";
import { SEES_EVERYTHING, type Viewer } from "./bot-visibility.ts";
import type { DecisionActor } from "./decision-log.ts";
import type { RequestAuth } from "./request-auth.ts";
import type { UsageTrigger } from "./usage-ledger.ts";

/** Loopback is not the owner on a Cloud home: only processes on the machine (a bot's shell) arrive that way. */
export function cloudOwnerSession(auth: RequestAuth): boolean {
  return auth.kind === "session" && auth.scopes.includes("admin");
}

export function cloudCardRefusal(auth: RequestAuth & { kind: "session" }): string | null {
  return auth.scopes.includes("admin") ? null : "Only the owner of this Cloud can answer this card.";
}

export function canManageCommandAllowlist(auth: RequestAuth): boolean {
  return auth.kind === "loopback" ? auth.trust !== "service" : auth.scopes.includes("admin");
}

export function decisionActorFor(auth: RequestAuth): DecisionActor {
  if (auth.kind === "loopback") return auth.trust === "service" ? { kind: "worker" } : { kind: "loopback" };
  const session = auth.session;
  return {
    kind: "session", sessionId: session.id, label: session.label,
    ...(session.email ? { email: session.email } : {}),
    // A portal session's id is its membership grant: never written down.
    ...(session.userId && !session.userId.startsWith("portal:") ? { userId: session.userId } : {}),
  };
}

export function viewerFor(auth: RequestAuth): Viewer {
  if (auth.kind === "loopback" || auth.scopes.includes("admin")) return SEES_EVERYTHING;
  return { kind: "member", ...(auth.session.email ? { email: auth.session.email } : {}) };
}

export function usageTriggerFor(auth: RequestAuth): UsageTrigger {
  return auth.kind === "session"
    ? { kind: "user", ...(auth.session.email ? { email: auth.session.email } : {}), label: auth.session.label }
    : { kind: "owner" };
}

export function queuedTurnTrigger(item: { trigger?: UsageTrigger; sender?: ResolvedSender; peerAsk?: unknown }): UsageTrigger | undefined {
  if (item.trigger) return item.trigger;
  if (item.peerAsk) return undefined;
  return item.sender ? { kind: "user", label: item.sender.name } : { kind: "owner" };
}
