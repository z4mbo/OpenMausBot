import type { OriginCloudClient, OriginCloudState } from "./origin-cloud.ts";

type Session = Pick<OriginCloudState, "url" | "sessionToken">;
type ConnectedSession = Required<Session>;
type Snapshot = Session & { revision: number };
type Owner = { verified: true; email: string | null } | { verified: false };

const sameSession = (left: Session, right: Session) => left.url === right.url && left.sessionToken === right.sessionToken;

export function createOriginCloudSession(deps: {
  read(): OriginCloudState;
  write(state: OriginCloudState): void;
  connect(url: string): OriginCloudClient;
}) {
  let revision = 0;
  return {
    snapshot(): Snapshot {
      const { url, sessionToken } = deps.read();
      return { url, sessionToken, revision };
    },
    async owner(state: Snapshot, replacement?: ConnectedSession): Promise<Owner> {
      const { url, sessionToken } = state;
      if (!url || !sessionToken || (replacement && sameSession(state, replacement))) return { verified: true, email: null };
      try {
        const user = await deps.connect(url).query("auth:me", { sessionToken });
        const email = user !== null && typeof user === "object" && !Array.isArray(user) && "email" in user && typeof user.email === "string" ? user.email.toLowerCase() : null;
        return { verified: true, email: email || null };
      } catch {
        return { verified: false };
      }
    },
    commit(previous: Snapshot, replacement?: ConnectedSession): boolean {
      const current = deps.read();
      if (previous.revision !== revision || !sameSession(previous, current)) return false;
      deps.write({ ...replacement, projects: current.projects });
      revision += 1;
      return true;
    },
  };
}
