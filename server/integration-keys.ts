import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";
import type { IntegrationStatus } from "../shared/integration-keys.ts";

type Field = {
  label: string;
  /** Write-only: the value never leaves this computer's server, not even to this person's own client. */
  secret: boolean;
  optional?: true;
  placeholder?: string;
};

type Integration = { label: string; help: string; fields: Record<string, Field> };

/**
 * Third-party accounts a member connects for server-side work (Studio generations, Broadcast posts, Pipeline mail and
 * SMS). Each member keeps their own keys in this computer's data folder: they are never synced to Origin's backend,
 * never put in a backup and never returned to a client (non-secret fields such as a sender address are).
 */
export const INTEGRATIONS = {
  fal: { label: "fal.ai", help: "https://fal.ai/dashboard/keys", fields: { key: { label: "API key", secret: true, placeholder: "key-id:secret" } } },
  elevenlabs: { label: "ElevenLabs", help: "https://elevenlabs.io/app/settings/api-keys", fields: { apiKey: { label: "API key", secret: true, placeholder: "sk_…" } } },
  openai: { label: "OpenAI", help: "https://platform.openai.com/api-keys", fields: { apiKey: { label: "API key", secret: true, placeholder: "sk-…" } } },
  twilio: {
    label: "Twilio", help: "https://console.twilio.com",
    fields: {
      accountSid: { label: "Account SID", secret: false, placeholder: "AC…" },
      authToken: { label: "Auth token", secret: true },
      fromNumber: { label: "From number", secret: false, placeholder: "+15551234567" },
    },
  },
  brevo: {
    label: "Brevo", help: "https://app.brevo.com/settings/keys/api",
    fields: {
      apiKey: { label: "API key", secret: true, placeholder: "xkeysib-…" },
      senderEmail: { label: "Sender email", secret: false, placeholder: "hello@example.com" },
      senderName: { label: "Sender name", secret: false, optional: true },
    },
  },
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

/** The member's values for one integration, or null until every required field is set. Server-side only. */
export function integrationKey<I extends IntegrationId>(id: I, file = defaultIntegrationKeysFile()): IntegrationValues<I> | null {
  const values: Record<string, string> = readStored(file)[id] ?? {};
  const missing = Object.entries(fieldsOf(id)).some(([name, field]) => !field.optional && !values[name]);
  return missing ? null : (values as IntegrationValues<I>);
}

export function integrationConfigured(id: IntegrationId, file = defaultIntegrationKeysFile()): boolean {
  return integrationKey(id, file) !== null;
}

export function integrationStatuses(file = defaultIntegrationKeysFile()): IntegrationStatus[] {
  const stored = readStored(file);
  return (Object.keys(INTEGRATIONS) as IntegrationId[]).map((id) => {
    const values = stored[id] ?? {};
    const fields = Object.entries(fieldsOf(id)).map(([name, field]) => ({
      name, label: field.label, secret: field.secret, optional: Boolean(field.optional),
      ...(field.placeholder ? { placeholder: field.placeholder } : {}),
      set: Boolean(values[name]),
      ...(!field.secret && values[name] ? { value: values[name] } : {}),
    }));
    return { id: id as string, label: INTEGRATIONS[id].label, help: INTEGRATIONS[id].help, configured: integrationConfigured(id, file), fields };
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

export function createIntegrationKeyRoutes(file: () => string = defaultIntegrationKeysFile): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path === "/api/integrations" && method === "GET") return json(res, 200, { integrations: integrationStatuses(file()) });
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
    return json(res, 200, { integration: integrationStatuses(file()).find((entry) => entry.id === id) });
  };
}
