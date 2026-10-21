import { addHeldSecretScrubber, HELD_SECRET_MASK } from "../shared/redact.ts";
import { convexAction } from "./github/broker.ts";
import { defaultOriginCloudFile, readOriginCloud, type OriginCloudState } from "./origin-cloud.ts";

/** A key a workspace or project admin shared, as this person's server may use it. */
export interface SharedKey {
  integration: string;
  teamId: string;
  projectId: string | null;
  projectName: string | null;
  sharedByName: string;
  values: Record<string, string>;
  updatedAt: number;
}

/** Where a key is wanted: a project's work, a workspace, or neither when the caller has no context. */
export type KeyScope = { teamId?: string; projectId?: string };

const REFRESH_MS = 5 * 60_000;

type Resolve = (url: string, sessionToken: string) => Promise<SharedKey[]>;

/**
 * Security: the keys an admin shared live here in memory only, fetched with the person's own Origin session from the
 * backend, which opens them only for editors of the workspace or project they were shared with. Every value is
 * registered with the redaction scrubber, so it is masked wherever a transcript, log or tool title would show it.
 */
export function createSharedKeys(options: { cloud?: () => OriginCloudState; resolve?: Resolve; now?: () => number } = {}) {
  const cloud = options.cloud ?? (() => readOriginCloud(defaultOriginCloudFile()));
  const resolve: Resolve = options.resolve ?? ((url, sessionToken) => convexAction<SharedKey[]>(url, "sharedKeys:resolve", { sessionToken }));
  const now = options.now ?? Date.now;
  let held: { identity: string; keys: SharedKey[] } = { identity: "", keys: [] };
  let fetchedAt = 0;
  let running: Promise<void> | null = null;
  let error = "";
  const identity = () => {
    const { url, sessionToken } = cloud();
    return `${url ?? ""}|${sessionToken ?? ""}`;
  };
  const keys = () => (held.identity === identity() ? held.keys : []);
  const scrub = addHeldSecretScrubber((text) => {
    let out = text;
    for (const key of held.keys) for (const value of Object.values(key.values)) if (value.length >= 8) out = out.split(value).join(HELD_SECRET_MASK);
    return out;
  });

  const refresh = (): Promise<void> => {
    running ??= (async () => {
      const { url, sessionToken } = cloud();
      const asked = identity();
      if (!url || !sessionToken) { held = { identity: asked, keys: [] }; return; }
      let next: SharedKey[] = [];
      try {
        next = await resolve(url, sessionToken);
        error = "";
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
      if (asked !== identity()) return;
      held = { identity: asked, keys: next };
      fetchedAt = now();
    })().finally(() => { running = null; });
    return running;
  };

  const stale = () => now() - fetchedAt > REFRESH_MS || held.identity !== identity();

  return {
    refresh,
    /** Fresh enough keys, waiting at most `waitMs` for a refresh. */
    async current(waitMs = 3_000): Promise<SharedKey[]> {
      if (stale()) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([refresh(), new Promise((resolveWait) => { timer = setTimeout(resolveWait, waitMs); })]).finally(() => clearTimeout(timer));
      }
      return keys();
    },
    /**
     * The values shared for `integration`: the project's own when `projectId` is given, else a workspace's, but only
     * when a single workspace shared one (or `teamId` names it), so a key never crosses into another workspace's work.
     * A key shared with one project is never returned for any other. Starts a refresh when the cache is old and answers
     * from what this same sign-in fetched meanwhile.
     */
    find(integration: string, scope: KeyScope = {}): SharedKey | null {
      if (stale()) void refresh();
      const matching = keys().filter((key) => key.integration === integration && (!scope.teamId || key.teamId === scope.teamId));
      const project = scope.projectId ? matching.find((key) => key.projectId === scope.projectId) : undefined;
      const workspace = matching.filter((key) => !key.projectId).sort((a, b) => b.updatedAt - a.updatedAt);
      const oneTeam = new Set(workspace.map((key) => key.teamId)).size === 1;
      return project ?? (oneTeam ? workspace[0]! : null);
    },
    /** Every key shared for `integration` with a workspace or one of its projects, newest first. */
    shares(integration: string, teamId?: string): SharedKey[] {
      if (stale()) void refresh();
      return keys().filter((key) => key.integration === integration && (!teamId || key.teamId === teamId)).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    error: () => error,
    close: scrub,
  };
}

export type SharedKeys = ReturnType<typeof createSharedKeys>;

let shared: SharedKeys | null = null;

/** The server's one cache of shared keys. */
export function sharedKeys(): SharedKeys {
  shared ??= createSharedKeys();
  return shared;
}
