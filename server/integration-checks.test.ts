import { describe, expect, it, vi } from "vitest";
import { checkIntegration } from "./integration-checks.ts";
import { INTEGRATIONS, type IntegrationId } from "./integration-keys.ts";

const checkedAt = 1_700_000_000_000;
const secret = "provider-secret-value";
const environment = (fetch: typeof globalThis.fetch) => ({ fetch, now: () => checkedAt, nonce: () => "fixed-nonce" });
type ProviderCase = {
  id: IntegrationId;
  values: Record<string, string>;
  url: string;
  headers?: Record<string, string>;
  method?: string;
  body?: unknown;
  response: unknown;
  account?: string;
};

const cases: ProviderCase[] = [
  { id: "fal", values: { key: secret },
    url: "https://queue.fal.run/fal-ai/fast-sdxl/requests/00000000-0000-0000-0000-000000000000/status",
    headers: { Authorization: `Key ${secret}` }, response: {} },
  { id: "elevenlabs", values: { apiKey: secret }, url: "https://api.elevenlabs.io/v1/user",
    headers: { "xi-api-key": secret }, response: { subscription: { tier: "creator" }, first_name: "Ada" }, account: "creator" },
  { id: "openai", values: { apiKey: secret }, url: "https://api.openai.com/v1/models",
    headers: { Authorization: `Bearer ${secret}` }, response: { data: [] } },
  { id: "resend", values: { apiKey: secret, senderEmail: "sender@example.test" }, url: "https://api.resend.com/domains",
    headers: { Authorization: `Bearer ${secret}` }, response: { data: [] } },
  { id: "x", values: { apiKey: "consumer-key-value", apiSecret: "consumer-secret-value", accessToken: "access-token-value", accessSecret: "access-secret-value" },
    url: "https://api.x.com/2/users/me", response: { data: { username: "ada" } }, account: "@ada" },
  { id: "linkedin", values: { accessToken: secret, authorUrn: "urn:li:person:example" }, url: "https://api.linkedin.com/v2/userinfo",
    headers: { Authorization: `Bearer ${secret}` }, response: { name: "Ada Lovelace" }, account: "Ada Lovelace" },
  { id: "bluesky", values: { handle: "@ada.bsky.social", appPassword: secret }, url: "https://bsky.social/xrpc/com.atproto.server.createSession",
    method: "POST", headers: { "Content-Type": "application/json" }, body: { identifier: "ada.bsky.social", password: secret },
    response: { handle: "ada.bsky.social" }, account: "@ada.bsky.social" },
  { id: "meta", values: { pageAccessToken: `${secret}+/=&?`, facebookPageId: "12345678", instagramUserId: "87654321" },
    url: `https://graph.facebook.com/v23.0/me?fields=id,name&access_token=${encodeURIComponent(`${secret}+/=&?`)}`,
    response: { name: "Example Page" }, account: "Example Page" },
  { id: "tiktok", values: { accessToken: secret }, url: "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
    method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json; charset=UTF-8" },
    response: { data: { creator_username: "ada" }, error: { code: "ok" } }, account: "@ada" },
  { id: "vercel", values: { apiToken: secret }, url: "https://api.vercel.com/v2/user",
    headers: { Authorization: `Bearer ${secret}` }, response: { user: { username: "ada" } }, account: "ada" },
  { id: "netlify", values: { apiToken: secret }, url: "https://api.netlify.com/api/v1/user",
    headers: { Authorization: `Bearer ${secret}` }, response: { full_name: "Ada Lovelace", email: "ada@example.test" }, account: "Ada Lovelace" },
  { id: "cloudflare", values: { apiToken: secret }, url: "https://api.cloudflare.com/client/v4/user/tokens/verify",
    headers: { Authorization: `Bearer ${secret}` }, response: { success: true, result: { status: "active" } } },
];

describe("integration checks", () => {
  it("covers the integration registry", () => {
    expect(cases.map(({ id }) => id).sort()).toEqual(Object.keys(INTEGRATIONS).sort());
  });

  describe.each(cases)("$id", (provider) => {
    it("makes one bounded request and reads the account", async () => {
      const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(provider.response));
      const timeout = vi.spyOn(AbortSignal, "timeout");
      try {
        const check = await checkIntegration(provider.id, provider.values, environment(request));
        expect(check).toEqual({ ok: true, detail: `${INTEGRATIONS[provider.id].label} accepted the key`, checkedAt,
          ...(provider.account ? { account: provider.account } : {}) });
        expect(request).toHaveBeenCalledTimes(1);
        const [url, init] = request.mock.calls[0]!;
        expect(url).toBe(provider.url);
        expect(init?.method).toBe(provider.method ?? "GET");
        expect(timeout).toHaveBeenCalledWith(8000);
        expect(init?.signal).toBe(timeout.mock.results[0]!.value);
        expect(init?.redirect).toBe("manual");
        const headers = new Headers(init?.headers);
        if (provider.id === "x") {
          const auth = headers.get("Authorization");
          expect(auth).toMatch(/^OAuth /);
          expect(auth).toContain('oauth_consumer_key="consumer-key-value"');
          expect(auth).toContain('oauth_token="access-token-value"');
          expect(auth).toContain('oauth_nonce="fixed-nonce"');
          expect(auth).toContain('oauth_timestamp="1700000000"');
          expect(auth).toContain('oauth_signature_method="HMAC-SHA1"');
          expect(auth).toMatch(/oauth_signature="[^"]+"/);
        } else expect(Object.fromEntries(headers)).toEqual(Object.fromEntries(new Headers(provider.headers)));
        if (provider.body) expect(JSON.parse(init!.body as string)).toEqual(provider.body);
        else expect(init?.body).toBeUndefined();
      } finally { timeout.mockRestore(); }
    });

    it("rejects a 401 and scrubs every supplied value from the vendor message", async () => {
      const message = `Invalid credentials: ${Object.values(provider.values).join("; ")}`;
      const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message } }, { status: 401 }));
      const check = await checkIntegration(provider.id, provider.values, environment(request));
      expect(check).toMatchObject({ ok: false, checkedAt });
      expect(check.detail).toContain(`${INTEGRATIONS[provider.id].label} rejected the key: Invalid credentials:`);
      for (const value of Object.values(provider.values)) expect(check.detail).not.toContain(value);
      expect(check.detail).toContain("[...]");
      expect(check).not.toHaveProperty("account");
      expect(request).toHaveBeenCalledTimes(1);
    });

    it.each([new TypeError("network failed"), new DOMException("deadline exceeded", "TimeoutError")])("handles unreachable providers: %s", async (error) => {
      const request = vi.fn<typeof fetch>().mockRejectedValue(error);
      expect(await checkIntegration(provider.id, provider.values, environment(request))).toEqual({
        ok: false, detail: `Could not reach ${INTEGRATIONS[provider.id].label}`, checkedAt,
      });
      expect(request).toHaveBeenCalledTimes(1);
    });

    it("requires every mandatory field before making a request", async () => {
      const request = vi.fn<typeof fetch>();
      const fields: Record<string, { label: string; optional?: boolean }> = INTEGRATIONS[provider.id].fields;
      for (const [name, field] of Object.entries(fields)) {
        if (field.optional) continue;
        const values = { ...provider.values };
        delete values[name];
        const expected = { ok: false, detail: `Fill in ${field.label} first`, checkedAt };
        expect(await checkIntegration(provider.id, values, environment(request))).toEqual(expected);
        expect(await checkIntegration(provider.id, { ...values, [name]: "   " }, environment(request))).toEqual(expected);
      }
      expect(request).not.toHaveBeenCalled();
    });
  });

  it.each([200, 302, 404, 429, 500])("accepts fal's authenticated status %i", async (status) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status }));
    expect(await checkIntegration("fal", { key: secret }, environment(request))).toMatchObject({ ok: true });
  });

  it("rejects fal's 403", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status: 403 }));
    expect(await checkIntegration("fal", { key: secret }, environment(request))).toMatchObject({ ok: false });
  });

  it("accepts Resend's sending-only key", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ name: "restricted_api_key" }, { status: 401 }));
    expect(await checkIntegration("resend", { apiKey: secret, senderEmail: "ada@example.test" }, environment(request)))
      .toMatchObject({ ok: true, detail: "Resend can send email but cannot list domains" });
  });

  it("accepts LinkedIn's valid token without openid", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status: 403 }));
    expect(await checkIntegration("linkedin", { accessToken: secret, authorUrn: "urn:li:person:ada" }, environment(request)))
      .toMatchObject({ ok: true, detail: "LinkedIn accepted the token but it lacks the openid scope" });
  });

  it("rejects TikTok's error inside a successful HTTP response", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: "access_token_invalid", message: `Replace ${secret}` } }));
    expect(await checkIntegration("tiktok", { accessToken: secret }, environment(request)))
      .toMatchObject({ ok: false, detail: "TikTok rejected the key: Replace [...]" });
  });

  it.each([{ success: false, result: { status: "active" } }, { success: true, result: { status: "expired" } }, {}])("rejects inactive Cloudflare results: %j", async (response) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
    expect(await checkIntegration("cloudflare", { apiToken: secret }, environment(request))).toMatchObject({ ok: false });
  });

  it.each([
    { id: "elevenlabs", response: { first_name: "Ada" }, account: "Ada" },
    { id: "netlify", response: { email: "ada@example.test" }, account: "ada@example.test" },
  ] as const)("uses $id's fallback account", async ({ id, response, account }) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
    expect(await checkIntegration(id, cases.find((provider) => provider.id === id)!.values, environment(request))).toMatchObject({ account });
  });

  it.each([
    { detail: { message: "Vendor explanation" } }, { detail: "Vendor explanation" },
    { message: "Vendor explanation" }, { errors: [{ message: "Vendor explanation" }] },
  ])("reads provider errors: %j", async (response) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response, { status: 400 }));
    expect(await checkIntegration("openai", { apiKey: secret }, environment(request)))
      .toMatchObject({ ok: false, detail: "OpenAI rejected the key: Vendor explanation" });
  });

  it("bounds vendor text after scrubbing repeated and overlapping values", async () => {
    const apiKey = "a-secret-key";
    const senderEmail = "a-secret-key@example.test";
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(`${senderEmail} ${apiKey} ${apiKey} ${"x".repeat(300)}`, { status: 400 }));
    const check = await checkIntegration("resend", { apiKey, senderEmail }, environment(request));
    expect(check.detail).toHaveLength("Resend rejected the key: ".length + 200);
    expect(check.detail).not.toContain(apiKey);
    expect(check.detail).not.toContain(senderEmail);
  });
});
