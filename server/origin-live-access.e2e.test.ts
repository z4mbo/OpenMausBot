import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LiveCallState, LiveClient } from "../shared/wire.ts";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import { startFakeOpenAiLive, type FakeOpenAiLive } from "./testing/fake-openai-live.ts";

describe("Origin Live calls without an upstream subscription", () => {
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  let live: FakeOpenAiLive;
  let botId: string;
  const key = "sk-origin-isolated-live";
  const request = async (path: string, body: unknown, headers: Record<string, string> = {}, method: "POST" | "PUT" = "POST") => {
    const response = await fetch(new URL(path, fixture!.info.url), {
      method,
      headers: { "content-type": "application/json", origin: fixture!.info.url, ...headers },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };

  beforeAll(async () => {
    live = await startFakeOpenAiLive();
    fixture = await launchVerificationServer({ PATH: process.env.PATH, OMB_OPENAI_LIVE_URL: live.url });
    const response = await fetch(new URL("/api/bots", fixture.info.url));
    botId = (await response.json() as { bots: Array<{ id: string }> }).bots[0].id;
  }, 60_000);

  afterAll(async () => {
    await fixture?.close();
    await live?.stop();
  });

  const clients: Array<{ client: LiveClient; companion?: true }> = [
    { client: "desktop" }, { client: "web" }, { client: "ios" }, { client: "android" },
    { client: "web", companion: true }, { client: "android", companion: true },
  ];
  const phoneHeaders = { "x-openmausbot-companion": "1", "x-openmausbot-companion-device": "fixture-phone" };

  for (const { client, companion } of clients) {
    it(`${client}${companion ? " through the companion" : ""} asks for its own key and starts without a plan`, async () => {
      const headers = companion ? phoneHeaders : {};
      expect((await request("/api/config", { live: { key: "" } }, {}, "PUT")).status).toBe(200);
      const before = live.sessions.length;
      const missing = await request("/api/live/session", { botId, client, sdp: "v=0\r\n" }, headers);
      expect(missing).toMatchObject({ status: 409, body: { needsKey: true } });
      expect(missing.body).not.toHaveProperty("needsPro");
      expect(live.sessions).toHaveLength(before);

      expect((await request("/api/config", { live: { key } }, {}, "PUT")).status).toBe(200);
      const started = await request("/api/live/session", { botId, client, sdp: "v=0\r\n" }, headers);
      expect(started.status).toBe(201);
      expect(JSON.stringify(started.body)).not.toContain(key);
      const call = (started.body as { call: LiveCallState }).call;
      expect(call.client).toBe(client);
      const session = live.sessions[before];
      expect(session.key).toBe(key);
      await live.waitForAttach(session.id);
      expect((await request("/api/live/call/end", { callId: call.callId }, headers)).status).toBe(200);
      expect(session.closed).toBe(true);
      const config = await fetch(new URL("/api/config", fixture!.info.url)).then(response => response.text());
      expect(config).not.toContain(key);
    }, 20_000);
  }

  it("still denies cross-origin requests and unknown bots before contacting the provider", async () => {
    const before = live.sessions.length;
    expect((await request("/api/live/session", { botId, client: "ios", sdp: "v=0\r\n" }, { origin: "https://untrusted.invalid" })).status).toBe(403);
    expect((await request("/api/live/session", { botId: "missing-bot", client: "ios", sdp: "v=0\r\n" })).status).toBe(404);
    expect(live.sessions).toHaveLength(before);
  });
});
