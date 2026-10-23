import type { RuntimeEventListener } from "../contracts.ts";
import { killCliTree } from "../procs.ts";
import { createQuotaEventProofs } from "../quota-refusal.ts";
import { claudeAuthRecovery } from "./claude-auth-recovery.ts";

type Session = { child: Parameters<typeof killCliTree>[0]; closed: Promise<void> };

export function claudeTurnEvents(
  listeners: ReadonlySet<RuntimeEventListener>,
  sessions: ReadonlyMap<string, Session>,
  active: { has(threadId: string): boolean },
  stop: typeof killCliTree = killCliTree,
) {
  const authRecovery = claudeAuthRecovery(event => {
    for (const listener of Array.from(listeners)) listener(event);
  }, async threadId => {
    const session = sessions.get(threadId);
    if (!session || !(await stop(session.child))) return false;
    await session.closed;
    return sessions.get(threadId) !== session;
  }, threadId => active.has(threadId));
  const quotaProofs = createQuotaEventProofs(authRecovery.emit);
  return { authRecovery, quotaProofs, emit: quotaProofs.emit };
}
