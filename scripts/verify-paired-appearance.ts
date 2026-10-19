import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { createProxyHandler } from "../companion/src/proxy.ts";
import { launchVerificationServer, runControlOmb } from "./control-omb.ts";

const evidence = join(import.meta.dirname, "..", "docs", "verification", "evidence", "origin-upstream");
const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_REPLIES: JSON.stringify(["Appearance fixture reply"]) });
const token = "paired-appearance-fixture-token";
const sidecar = createServer(createProxyHandler({
  harnessPort: Number(new URL(fixture.info.url).port),
  authenticate: (candidate) => candidate === token ? { id: "fixture-device", cloudDesktopAccess: false, browserControlAccess: false } : null,
  redeem: () => ({ error: "Pairing is not part of this fixture" }),
  serverName: () => "Appearance fixture",
}));
const events: { target: string; method: string; path: string; status: number }[] = [];
try {
  await new Promise<void>((resolve, reject) => {
    sidecar.once("error", reject);
    sidecar.listen(0, "127.0.0.1", resolve);
  });
  const proxyUrl = `http://127.0.0.1:${(sidecar.address() as AddressInfo).port}`;
  const request = async (target: "host" | "paired", method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch((target === "host" ? fixture.info.url : proxyUrl) + path, {
      method,
      headers: { "content-type": "application/json", ...(target === "host" ? { origin: fixture.info.url } : { authorization: `Bearer ${token}` }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    events.push({ target, method, path, status: response.status });
    return { status: response.status, body: await response.json() };
  };
  const { body: { bots } } = await request("host", "GET", "/api/bots?messages=0");
  const bot = bots[0];
  assert.ok(bot?.id);
  const path = `/api/bots/${bot.id}`;
  const appearance = { color: "teal", mascotBody: "star", mascotExpression: "happy", avatarCrop: "square", avatarZoom: 1.5, avatarFocusX: 0.25, avatarFocusY: 0.75 };
  const saved = await request("paired", "PATCH", path, appearance);
  assert.equal(saved.status, 200);
  for (const [field, value] of Object.entries(appearance)) assert.equal(saved.body.bot[field], value);
  const hostBot = async () => (await request("host", "GET", "/api/bots?messages=0")).body.bots.find((candidate: { id: string }) => candidate.id === bot.id);
  for (const [field, value] of Object.entries(appearance)) assert.equal((await hostBot())[field], value);
  const reset = await request("paired", "PATCH", path, { avatarCrop: "mascot", mascotExpression: null, mascotBody: "cursor" });
  assert.equal(reset.status, 200);
  assert.equal((await hostBot()).avatarCrop, "mascot");
  const snapshot = await hostBot();
  for (const protectedBody of [{ color: "coral", autoApprove: true }, JSON.parse('{"color":"coral","__proto__":{}}')]) {
    const refused = await request("paired", "PATCH", path, protectedBody, { "x-openmausbot-companion": "0" });
    assert.equal(refused.status, 403);
    assert.deepEqual(await hostBot(), snapshot);
  }
  for (const invalid of [{ color: "#168aad" }, { mascotExpression: 5 }, { mascotExpression: "x".repeat(81) }, { pinned: [] }]) {
    for (const target of ["host", "paired"] as const) {
      assert.equal((await request(target, "PATCH", path, invalid)).status, 400);
      assert.deepEqual(await hostBot(), snapshot);
    }
  }
  for (const authorization of ["", "Bearer wrong-fixture-token"]) {
    assert.equal((await request("paired", "PATCH", path, { color: "blue" }, { authorization })).status, 401);
  }
  const send = await runControlOmb(["send", "--bot", bot.id, "--text", "Check the appearance fixture", "--url", fixture.info.url]);
  const wait = await runControlOmb(["wait", "--bot", bot.id, "--timeout", "30", "--url", fixture.info.url]) as { status: string };
  assert.equal(wait.status, "settled");
  const messages = await runControlOmb(["messages", "--bot", bot.id, "--limit", "10", "--url", fixture.info.url]) as { messages: { text?: string }[] };
  assert.ok(messages.messages.some((message) => message.text === "Appearance fixture reply"));
  mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, "paired-appearance.json"), JSON.stringify({
    passed: true, fixture: fixture.info, proxyUrl, verification: "Real isolated fake-engine server and companion proxy; synthetic paired credential; no native phone or personal account", events, send, wait, messages,
  }, null, 2) + "\n");
  console.log(JSON.stringify({ passed: true, evidence: join(evidence, "paired-appearance.json"), logPath: fixture.info.logPath }));
} finally {
  sidecar.closeAllConnections();
  await new Promise<void>((resolve) => sidecar.close(() => resolve()));
  await fixture.close();
}
