import { randomUUID } from "node:crypto";
import type { IntegrationCheck } from "../shared/integration-keys.ts";
import { oauth1Header } from "./broadcast/oauth1.ts";
import { INTEGRATIONS, type IntegrationId } from "./integration-keys.ts";

type Environment = { fetch: typeof fetch; now(): number; nonce(): string };
type Data = Record<string, unknown>;
type Verdict = { ok: boolean; detail?: string };
type Probe = {
  url: string;
  headers: Record<string, string>;
  method?: string;
  body?: string;
  account?: (data: Data) => unknown;
  verdict?: (response: Response, data: Data, message: string) => Verdict | undefined;
};

const defaults: Environment = { fetch: (...args) => fetch(...args), now: Date.now, nonce: randomUUID };
const object = (value: unknown): Data => value && typeof value === "object" && !Array.isArray(value) ? value as Data : {};
const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value : undefined;
const handle = (value: unknown) => text(value) ? `@${text(value)!.replace(/^@/, "")}` : undefined;
const bearer = (value: string) => ({ Authorization: `Bearer ${value}` });

const probes: Record<IntegrationId, (values: Record<string, string>, env: Environment) => Probe> = {
  fal: (v) => ({
    url: "https://queue.fal.run/fal-ai/fast-sdxl/requests/00000000-0000-0000-0000-000000000000/status",
    headers: { Authorization: `Key ${v.key}` },
    // fal's queue API authenticates before looking up a request: even 404 accepts the key; only 401/403 reject it.
    verdict: (r) => ({ ok: r.status !== 401 && r.status !== 403 }),
  }),
  elevenlabs: (v) => ({
    url: "https://api.elevenlabs.io/v1/user", headers: { "xi-api-key": v.apiKey! },
    account: (d) => text(object(d.subscription).tier) ?? d.first_name,
  }),
  openai: (v) => ({ url: "https://api.openai.com/v1/models", headers: bearer(v.apiKey!) }),
  resend: (v) => ({
    url: "https://api.resend.com/domains", headers: bearer(v.apiKey!),
    verdict: (r, d) => r.status === 401 && d.name === "restricted_api_key"
      ? { ok: true, detail: "Resend can send email but cannot list domains" } : undefined,
  }),
  x: (v, env) => {
    const url = "https://api.x.com/2/users/me";
    const credentials = { apiKey: v.apiKey!, apiSecret: v.apiSecret!, accessToken: v.accessToken!, accessSecret: v.accessSecret! };
    return { url, headers: { Authorization: oauth1Header("GET", url, credentials, { nonce: env.nonce(), timestamp: Math.floor(env.now() / 1000) }) },
      account: (d) => handle(object(d.data).username) };
  },
  linkedin: (v) => ({
    url: "https://api.linkedin.com/v2/userinfo", headers: bearer(v.accessToken!), account: (d) => d.name,
    verdict: (r) => r.status === 403 ? { ok: true, detail: "LinkedIn accepted the token but it lacks the openid scope" } : undefined,
  }),
  bluesky: (v) => ({
    url: "https://bsky.social/xrpc/com.atproto.server.createSession", method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: v.handle!.replace(/^@/, ""), password: v.appPassword }),
    account: (d) => handle(d.handle),
  }),
  meta: (v) => ({
    url: `https://graph.facebook.com/v23.0/me?fields=id,name&access_token=${encodeURIComponent(v.pageAccessToken!)}`,
    headers: {}, account: (d) => d.name,
  }),
  tiktok: (v) => ({
    url: "https://open.tiktokapis.com/v2/post/publish/creator_info/query/", method: "POST",
    headers: { ...bearer(v.accessToken!), "Content-Type": "application/json; charset=UTF-8" },
    account: (d) => handle(object(d.data).creator_username),
    verdict: (r, d) => r.ok && object(d.error).code !== "ok" ? { ok: false } : undefined,
  }),
  vercel: (v) => ({
    url: "https://api.vercel.com/v2/user", headers: bearer(v.apiToken!), account: (d) => object(d.user).username,
  }),
  netlify: (v) => ({
    url: "https://api.netlify.com/api/v1/user", headers: bearer(v.apiToken!), account: (d) => text(d.full_name) ?? d.email,
  }),
  cloudflare: (v) => ({
    url: "https://api.cloudflare.com/client/v4/user/tokens/verify", headers: bearer(v.apiToken!),
    verdict: (r, d) => r.ok ? { ok: d.success === true && object(d.result).status === "active" } : undefined,
  }),
};

function messageOf(data: Data): string {
  const firstError = Array.isArray(data.errors) ? object(data.errors[0]) : {};
  return [object(data.error).message, data.message, object(data.detail).message, data.detail, firstError.message, data.error]
    .map(text).find(Boolean) ?? "";
}

function scrub(message: string, values: Record<string, string>): string {
  for (const value of Object.values(values).filter((v) => v.length >= 6).sort((a, b) => b.length - a.length)) {
    message = message.replaceAll(value, "[...]");
  }
  return message.replace(/\s+/g, " ").trim();
}

export async function checkIntegration(id: IntegrationId, values: Record<string, string>, env: Environment = defaults): Promise<IntegrationCheck> {
  const checkedAt = env.now();
  const { label } = INTEGRATIONS[id];
  const fields: Record<string, { label: string; optional?: boolean }> = INTEGRATIONS[id].fields;
  const missing = Object.entries(fields).find(([name, field]) => !field.optional && !values[name]?.trim());
  if (missing) return { ok: false, detail: `Fill in ${missing[1].label} first`, checkedAt };
  try {
    const probe = probes[id](values, env);
    const response = await env.fetch(probe.url, {
      method: probe.method ?? "GET", headers: probe.headers, ...(probe.body ? { body: probe.body } : {}),
      signal: AbortSignal.timeout(8000), redirect: "manual",
    });
    const raw = await response.text();
    let data: Data;
    try { data = object(JSON.parse(raw)); } catch { data = { message: raw }; }
    const message = messageOf(data);
    const verdict = probe.verdict?.(response, data, message);
    const ok = verdict?.ok ?? response.ok;
    const account = ok ? text(probe.account?.(data)) : undefined;
    const vendorDetail = scrub(message, values).slice(0, 200);
    const detail = verdict?.detail ?? (ok ? `${label} accepted the key` : `${label} rejected the key${vendorDetail ? `: ${vendorDetail}` : ""}`);
    return { ok, detail: scrub(detail, values), checkedAt, ...(account ? { account } : {}) };
  } catch {
    return { ok: false, detail: `Could not reach ${label}`, checkedAt };
  }
}
