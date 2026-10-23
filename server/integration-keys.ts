import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";
import type { IntegrationStatus } from "../shared/integration-keys.ts";
import { convexAction } from "./github/broker.ts";
import { convexOriginClient, defaultOriginCloudFile, readOriginCloud } from "./origin-cloud.ts";
import { sharedKeys, type KeyScope, type SharedKey, type SharedKeys } from "./shared-integration-keys.ts";
import { checkIntegration } from "./integration-checks.ts";

type Field = {
  label: string;
  /** Write-only: the value never leaves this computer's server, not even to this person's own client. */
  secret: boolean;
  optional?: true;
  placeholder?: string;
};

type Integration = { label: string; help: string; fields: Record<string, Field> };

/**
 * Third-party accounts a member connects for server-side work (Studio generations, Publish posts). Each
 * member keeps their own keys in this computer's data folder: they are never put in a backup and never returned to a
 * client (non-secret fields such as a sender address are). An admin may share theirs with the workspace or a project
 * through the backend; a member's own key always wins over a shared one.
 */
export const INTEGRATIONS = {
  fal: { label: "fal.ai", help: "https://fal.ai/dashboard/keys", fields: { key: { label: "API key", secret: true, placeholder: "key-id:secret" } } },
  elevenlabs: { label: "ElevenLabs", help: "https://elevenlabs.io/app/settings/api-keys", fields: { apiKey: { label: "API key", secret: true, placeholder: "sk_…" } } },
  openai: { label: "OpenAI", help: "https://platform.openai.com/api-keys", fields: { apiKey: { label: "API key", secret: true, placeholder: "sk-…" } } },
  resend: {
    label: "Resend", help: "https://resend.com/api-keys",
    fields: {
      apiKey: { label: "API key", secret: true, placeholder: "re_…" },
      senderEmail: { label: "Sender email", secret: false, placeholder: "hello@example.com" },
    },
  },
  x: {
    label: "X", help: "https://developer.x.com/en/portal/dashboard",
    fields: {
      apiKey: { label: "API key", secret: true },
      apiSecret: { label: "API secret", secret: true },
      accessToken: { label: "Access token", secret: true },
      accessSecret: { label: "Access token secret", secret: true },
    },
  },
  linkedin: {
    label: "LinkedIn", help: "https://www.linkedin.com/developers/apps",
    fields: {
      accessToken: { label: "Access token", secret: true },
      authorUrn: { label: "Author URN", secret: false, placeholder: "urn:li:person:… or urn:li:organization:…" },
    },
  },
  bluesky: {
    label: "Bluesky", help: "https://bsky.app/settings/app-passwords",
    fields: {
      handle: { label: "Handle", secret: false, placeholder: "name.bsky.social" },
      appPassword: { label: "App password", secret: true, placeholder: "xxxx-xxxx-xxxx-xxxx" },
    },
  },
  meta: {
    label: "Instagram & Facebook", help: "https://developers.facebook.com/tools/explorer",
    fields: {
      pageAccessToken: { label: "Page access token", secret: true },
      facebookPageId: { label: "Facebook page ID", secret: false, optional: true },
      instagramUserId: { label: "Instagram user ID", secret: false, optional: true },
    },
  },
  tiktok: {
    label: "TikTok", help: "https://developers.tiktok.com/doc/content-posting-api-get-started",
    fields: { accessToken: { label: "Access token (video.publish)", secret: true, placeholder: "act.…" } },
  },
  vercel: { label: "Vercel", help: "https://vercel.com/account/settings/tokens", fields: { apiToken: { label: "Access token", secret: true } } },
  netlify: { label: "Netlify", help: "https://app.netlify.com/user/applications#personal-access-tokens", fields: { apiToken: { label: "Personal access token", secret: true, placeholder: "nfp_…" } } },
  cloudflare: {
    label: "Cloudflare Pages", help: "https://dash.cloudflare.com/profile/api-tokens",
    fields: { apiToken: { label: "API token (Pages: Edit)", secret: true } },
  },
} as const satisfies Record<string, Integration>;

export type IntegrationId = keyof typeof INTEGRATIONS;
type FieldsOf<I extends IntegrationId> = (typeof INTEGRATIONS)[I]["fields"];
type OptionalName<I extends IntegrationId> = { [K in keyof FieldsOf<I>]: FieldsOf<I>[K] extends { optional: true } ? K : never }[keyof FieldsOf<I>];
/** A connected integration's values; optional fields are absent when the member left them empty. */
export type IntegrationValues<I extends IntegrationId> =
  { [K in Exclude<keyof FieldsOf<I>, OptionalName<I>>]: string } & { [K in OptionalName<I>]?: string };


const FILE_NAME = "integration-keys.json";
const VALUE_MAX = 4_096;

export function defaultIntegrationKeysFile(): string {
  return join(DATA_DIR, FILE_NAME);
}

export function isIntegrationId(value: unknown): value is IntegrationId {
  return typeof value === "string" && Object.hasOwn(INTEGRATIONS, value);
}

function fieldsOf(id: IntegrationId): Record<string, Field> {
  return INTEGRATIONS[id].fields;
}

type Stored = Partial<Record<IntegrationId, Record<string, string>>>;

function readStored(file: string): Stored {
  try {
    if (!existsSync(file)) return {};
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const stored: Stored = {};
    for (const [id, values] of Object.entries(raw)) {
      if (!isIntegrationId(id) || !values || typeof values !== "object") continue;
      const known = fieldsOf(id);
      stored[id] = Object.fromEntries(Object.entries(values as Record<string, unknown>)
        .filter((entry): entry is [string, string] => Object.hasOwn(known, entry[0]) && typeof entry[1] === "string" && entry[1] !== ""));
    }
    return stored;
  } catch {
    return {};
  }
}

const complete = (id: IntegrationId, values: Record<string, string>) => !Object.entries(fieldsOf(id)).some(([name, field]) => !field.optional && !values[name]);

const sharedFor = (file: string): SharedKeys | null => (file === defaultIntegrationKeysFile() ? sharedKeys() : null);

function usableValues(id: IntegrationId, found: SharedKey | null): Record<string, string> | null {
  const known = fieldsOf(id);
  const values = found ? Object.fromEntries(Object.entries(found.values).filter(([name]) => Object.hasOwn(known, name))) : null;
  return values && complete(id, values) ? values : null;
}

/** The values for one integration: the member's own, else a key shared with the project or workspace; null until every required field is set. Server-side only. */
export function integrationKey<I extends IntegrationId>(id: I, file = defaultIntegrationKeysFile(), projectId?: string): IntegrationValues<I> | null {
  const values: Record<string, string> = readStored(file)[id] ?? {};
  if (complete(id, values)) return values as IntegrationValues<I>;
  return usableValues(id, sharedFor(file)?.find(id, { projectId }) ?? null) as IntegrationValues<I> | null;
}

/** The values one project's work uses: the member's own, else the key shared with that project, else the workspace's. */
export function projectIntegrationKey<I extends IntegrationId>(id: I, projectId: string | undefined): IntegrationValues<I> | null {
  return integrationKey(id, defaultIntegrationKeysFile(), projectId);
}

export function integrationConfigured(id: IntegrationId, file = defaultIntegrationKeysFile()): boolean {
  return integrationKey(id, file) !== null;
}

const describeShare = (key: SharedKey) => ({ by: key.sharedByName, projectId: key.projectId, projectName: key.projectName });

/** Each service's state for a workspace or one of its projects; `shared` lets tests stand in for the backend's shared keys. */
export function integrationStatuses(file = defaultIntegrationKeysFile(), scope: KeyScope = {}, shared = sharedFor(file)): IntegrationStatus[] {
  const stored = readStored(file);
  return (Object.keys(INTEGRATIONS) as IntegrationId[]).map((id) => {
    const values = stored[id] ?? {};
    const fields = Object.entries(fieldsOf(id)).map(([name, field]) => ({
      name, label: field.label, secret: field.secret, optional: Boolean(field.optional),
      ...(field.placeholder ? { placeholder: field.placeholder } : {}),
      set: Boolean(values[name]),
      ...(!field.secret && values[name] ? { value: values[name] } : {}),
    }));
    const found = shared?.find(id, scope) ?? null;
    const own = complete(id, values);
    const usable = !own && usableValues(id, found) !== null;
    return {
      id: id as string, label: INTEGRATIONS[id].label, help: INTEGRATIONS[id].help, configured: own || usable,
      source: own ? "yours" as const : usable ? "shared" as const : null,
      shared: found ? describeShare(found) : null,
      shares: scope.teamId && shared ? shared.shares(id, scope.teamId).map(describeShare) : [],
      fields,
    };
  });
}

/** Sets the given fields ("" clears one) and keeps the rest; `null` clears the whole integration. */
export function saveIntegrationKeys(id: IntegrationId, change: Record<string, string> | null, file = defaultIntegrationKeysFile()): { ok: true } | { ok: false; error: string } {
  const stored = readStored(file);
  if (change === null) {
    delete stored[id];
  } else {
    const known = fieldsOf(id);
    const next = { ...stored[id] };
    for (const [name, raw] of Object.entries(change)) {
      if (!Object.hasOwn(known, name)) return { ok: false, error: `${INTEGRATIONS[id].label} has no field ${name.slice(0, 40)}` };
      if (typeof raw !== "string") return { ok: false, error: `${known[name]!.label} must be text` };
      const value = raw.trim();
      if (value.length > VALUE_MAX || /[\0\r\n]/.test(value)) return { ok: false, error: `${known[name]!.label} doesn't look right. Paste only the value.` };
      if (value) next[name] = value;
      else delete next[name];
    }
    if (Object.keys(next).length) stored[id] = next;
    else delete stored[id];
  }
  writeFileAtomic(file, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  return { ok: true };
}

/** Hands this person's own key for `id` to the backend, sealed there for the workspace or one project. */
async function shareIntegration(id: IntegrationId, file: string, sessionToken: string, scope: { teamId: string; projectId?: string }): Promise<void> {
  const values = readStored(file)[id] ?? {};
  if (!complete(id, values)) throw new Error(`Connect ${INTEGRATIONS[id].label} on this computer before sharing it`);
  const visible = Object.fromEntries(Object.entries(values).filter(([name]) => !fieldsOf(id)[name]?.secret));
  const { url } = readOriginCloud(defaultOriginCloudFile());
  if (!url) throw new Error("Sign in to Origin first");
  await convexAction(url, "sharedKeys:share", { sessionToken, teamId: scope.teamId, ...(scope.projectId ? { projectId: scope.projectId } : {}), integration: id, values, visible });
}

const unwrap = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /Uncaught Error: ([^\n]+)/.exec(message)?.[1]?.trim() ?? message;
};

export function createIntegrationKeyRoutes(file: () => string = defaultIntegrationKeysFile, deps: { fetch?: typeof fetch } = {}): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const scope: KeyScope = { teamId: url.searchParams.get("teamId") || undefined, projectId: url.searchParams.get("projectId") || undefined };
    if (path === "/api/integrations" && method === "GET") {
      await sharedKeys().current();
      return json(res, 200, { integrations: integrationStatuses(file(), scope), sharedError: sharedKeys().error() || null });
    }
    const checking = /^\/api\/integrations\/([a-z]+)\/check$/.exec(path);
    if (checking && method === "POST") {
      if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Checking integration keys needs the admin scope" });
      const id = checking[1];
      if (!isIntegrationId(id)) return json(res, 404, { error: "No such integration" });
      const body = await readBody(req) as { fields?: unknown } | null;
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "body must be an object" });
      if (body.fields !== undefined && (!body.fields || typeof body.fields !== "object" || Array.isArray(body.fields))) return json(res, 400, { error: "fields must be an object" });
      const known = fieldsOf(id);
      const draft: Record<string, string> = {};
      for (const [name, raw] of Object.entries(body.fields ?? {})) {
        if (!Object.hasOwn(known, name)) return json(res, 400, { error: `${INTEGRATIONS[id].label} has no field ${name.slice(0, 40)}` });
        if (typeof raw !== "string") return json(res, 400, { error: `${known[name]!.label} must be text` });
        const value = raw.trim();
        if (value.length > VALUE_MAX || /[\0\r\n]/.test(value)) return json(res, 400, { error: `${known[name]!.label} doesn't look right. Paste only the value.` });
        if (value) draft[name] = value;
      }
      const keyFile = file();
      const own = readStored(keyFile)[id] ?? {};
      const mine = Object.keys(draft).length > 0 || complete(id, own);
      if (!mine) await sharedKeys().current();
      const values = mine ? { ...own, ...draft } : usableValues(id, sharedFor(keyFile)?.find(id, scope) ?? null) ?? own;
      const check = await checkIntegration(id, values, { fetch: deps.fetch ?? fetch, now: Date.now, nonce: () => crypto.randomUUID() });
      return json(res, 200, { check });
    }
    const sharing = /^\/api\/integrations\/([a-z]+)\/share$/.exec(path);
    if (sharing && (method === "POST" || method === "DELETE")) {
      if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Sharing integration keys needs the admin scope" });
      const id = sharing[1];
      if (!isIntegrationId(id)) return json(res, 404, { error: "No such integration" });
      const { teamId, projectId } = scope;
      if (!teamId) return json(res, 400, { error: "Workspace required" });
      const header = req.headers["x-origin-session"];
      const sessionToken = (Array.isArray(header) ? header[0] : header)?.trim() ?? "";
      if (!sessionToken) return json(res, 401, { error: "Sign in to Origin first" });
      try {
        if (method === "POST") await shareIntegration(id, file(), sessionToken, { teamId, projectId });
        else {
          const { url: convexUrl } = readOriginCloud(defaultOriginCloudFile());
          if (!convexUrl) throw new Error("Sign in to Origin first");
          await convexOriginClient(convexUrl).mutation("sharedKeys:unshare", { sessionToken, teamId, ...(projectId ? { projectId } : {}), integration: id });
        }
      } catch (error) { return json(res, 400, { error: unwrap(error) }); }
      await sharedKeys().refresh();
      return json(res, 200, { integration: integrationStatuses(file(), scope).find((entry) => entry.id === id) });
    }
    const match = /^\/api\/integrations\/([a-z]+)$/.exec(path);
    if (!match || (method !== "PUT" && method !== "DELETE")) return PASS;
    if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Changing integration keys needs the admin scope" });
    const id = match[1];
    if (!isIntegrationId(id)) return json(res, 404, { error: "No such integration" });
    let change: Record<string, string> | null = null;
    if (method === "PUT") {
      const body = await readBody(req) as { fields?: unknown };
      if (!body.fields || typeof body.fields !== "object" || Array.isArray(body.fields)) return json(res, 400, { error: "fields must be an object" });
      change = body.fields as Record<string, string>;
    }
    const saved = saveIntegrationKeys(id, change, file());
    if (!saved.ok) return json(res, 400, { error: saved.error });
    return json(res, 200, { integration: integrationStatuses(file(), scope).find((entry) => entry.id === id) });
  };
}
