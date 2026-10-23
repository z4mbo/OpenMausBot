import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderInstance } from "../contracts.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { recordEvents, type EventRecorder } from "../testing/events.ts";
import { CodexDriver } from "./codex.ts";

vi.mock("./codex-release.ts", async importOriginal => ({
  ...await importOriginal<typeof import("./codex-release.ts")>(),
  readLatestCodexRelease: async () => "0.156.1",
}));

let instance: ProviderInstance | undefined, events: EventRecorder | undefined, home: string | undefined;
afterEach(async () => { events?.stop(); await instance?.dispose(); if (home) await removeTempDir(home); });

async function fixture(environment: Record<string, string> = {}) {
  home = mkdtempSync(join(tmpdir(), "origin-codex-hosted-isolation-"));
  const codexHome = join(home, ".codex"), dump = join(home, "native.json");
  mkdirSync(codexHome);
  instance = await CodexDriver.create({ instanceId: "synthetic-host-owner", displayName: "Synthetic owner", enabled: true,
    config: { ...CodexDriver.defaultConfig(), cli: fileURLToPath(new URL("../testing/fake-codex-app-server.ts", import.meta.url)) },
    environment: { HOME: home, USERPROFILE: home, CODEX_HOME: codexHome, FAKE_CODEX_DUMP: dump, ...environment } });
  events = recordEvents(instance.adapter);
  return { home, codexHome, dump, instance, events };
}

type NativeDump = { argv: string[]; calls: Array<{ method: string; params: Record<string, unknown> }> };
async function run(f: Awaited<ReturnType<typeof fixture>>, threadId: string) {
  const started = await f.instance.adapter.sendTurn({ threadId, text: "Canonical shared request", system: "Canonical shared instructions",
    approvalMode: "ask", guestConfined: true, mcpFromUserConfig: false, cwd: f.home, model: "gpt-5.6-sol" });
  await f.events.until(event => event.type === "turn.completed" && event.turnId === started.turnId);
  return existsSync(f.dump) ? JSON.parse(readFileSync(f.dump, "utf8")) as NativeDump : { argv: [], calls: [] };
}

describe("Codex hosted native configuration isolation", () => {
  it("keeps private owner developer instructions out of a confined shared request", async () => {
    const f = await fixture({ FAKE_CODEX_INSTRUCTIONS: "OWNER_PRIVATE_DEVELOPER_CANARY", FAKE_CODEX_MCP_OVERRIDES: "1" });
    const seen = await run(f, "hosted-private-instructions");
    const start = seen.calls.find(call => call.method === "thread/start");
    expect(start?.params.developerInstructions).toBe("Canonical shared instructions");
    expect(JSON.stringify(seen.calls.filter(call => call.method !== "config/read"))).not.toContain("OWNER_PRIVATE_DEVELOPER_CANARY");
  });

  it("disables owner native MCP even when the shared agent has no explicit tool scope", async () => {
    const f = await fixture({ FAKE_CODEX_MCP_OVERRIDES: "1" });
    writeFileSync(join(f.codexHome, "config.toml"), '[mcp_servers.owner_private]\ncommand="private-native-command"\n');
    const seen = await run(f, "hosted-native-mcp");
    expect(seen.argv).toContain("mcp_servers.owner_private.enabled=false");
    expect(seen.calls.some(call => call.method === "turn/start")).toBe(true);
  });

  it("refuses before dispatch if effective configuration still exposes an ambient MCP server", async () => {
    const f = await fixture({ FAKE_CODEX_MCP_CONFIG: JSON.stringify({ owner_private: { command: "private-native-command" } }) });
    const seen = await run(f, "hosted-mcp-not-disabled");
    expect(seen.calls.some(call => call.method === "turn/start")).toBe(false);
    expect(f.events.events.some(event => event.type === "runtime.error" && /MCP|configuration/i.test(event.message))).toBe(true);
    expect(f.events.events.find(event => event.type === "turn.completed")).toMatchObject({ ok: false });
  });
});
