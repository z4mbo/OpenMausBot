import type { RequestAuth } from "../request-auth.ts";

interface BrowserViewBot {
  id: string;
  browser?: boolean;
  browserProfile?: string;
}

interface BrowserViewAccess {
  auth: RequestAuth;
  botId: string;
  session: string;
  bot(id: string): BrowserViewBot | null;
  enabled(): boolean;
  sessionFor(botId: string, profile?: string): string;
  isLive(sessionId: string): boolean;
  visible(auth: RequestAuth, botId: string): boolean;
}

export function createBrowserViewAccess(deps: BrowserViewAccess) {
  const { auth } = deps;
  return {
    owner: auth.kind === "session" ? auth.session.id : "local-owner",
    isCurrent: () => {
      const current = deps.bot(deps.botId);
      return !!current && current.browser !== false && deps.enabled()
        && deps.sessionFor(current.id, current.browserProfile) === deps.session
        && (auth.kind !== "session" || deps.isLive(auth.session.id))
        && deps.visible(auth, current.id);
    },
  };
}
