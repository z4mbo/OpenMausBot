import { describe, expect, it, vi } from "vitest";
import { checkIntegration } from "./integration-checks.ts";
import { INTEGRATIONS, type IntegrationId } from "./integration-keys.ts";

const checkedAt = 1_700_000_000_000;
const secret = "provider-secret-value";
const environment = (fetch: typeof globalThis.fetch) => ({ fetch, now: () => checkedAt });
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
  { id: "elevenlabs", values: { apiKey: secret }, url: "https://api.elevenlabs.io/v1/user",
    headers: { "xi-api-key": secret }, response: { subscription: { tier: "creator" }, first_name: "Ada" }, account: "creator" },
  { id: "openai", values: { apiKey: secret }, url: "https://api.openai.com/v1/models",
    headers: { Authorization: `Bearer ${secret}` }, response: { data: [] } },
  { id: "resend", values: { apiKey: secret, senderEmail: "sender@example.test" }, url: "https://api.resend.com/domains",
    headers: { Authorization: `Bearer ${secret}` }, response: { data: [] } },
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
        expect(Object.fromEntries(headers)).toEqual(Object.fromEntries(new Headers(provider.headers)));
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

  it("accepts Resend's sending-only key", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ name: "restricted_api_key" }, { status: 401 }));
    expect(await checkIntegration("resend", { apiKey: secret, senderEmail: "ada@example.test" }, environment(request)))
      .toMatchObject({ ok: true, detail: "Resend can send email but cannot list domains" });
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
