import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("omits Stripe secret and restricted keys from actual provider-native logs", async () => {
  const prefixes = ["sk_" + "live_", "sk_" + "test_", "rk_" + "live_", "rk_" + "test_"];
  const keys = prefixes.map(prefix => prefix + "syntheticAbc0123456789".repeat(2));
  const reply = `Synthetic payment configuration: ${keys.join(" | ")}`;
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_REPLIES: JSON.stringify([reply]), FAKE_CLAUDE_TOOL_CALLS: "[]" });
  try {
    const response = await fetch(`${fixture.info.url}/api/bots`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: fixture.info.url },
      body: JSON.stringify({ name: "Payment audit" }),
    });
    expect(response.status).toBe(201);
    const { bot } = await response.json() as { bot: { id: string; threadId: string } };
    await runControlOmb(["send", "--bot", bot.id, "--task", bot.threadId, "--text", "Summarize the synthetic payment configuration.", "--url", fixture.info.url]);
    const logPath = join(fixture.info.dataDir, "native", `${bot.threadId}.ndjson`);
    const readReply = (): { message: { content: Array<{ text?: string }> } } | undefined => {
      try {
        const entries = readFileSync(logPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
        return entries.find(entry => entry.source === "claude.sdk.message" && entry.msg?.type === "assistant")?.msg;
      } catch { return undefined; }
    };
    await expect.poll(() => Boolean(readReply()), { timeout: 15_000 }).toBe(true);
    const message = readReply()!;
    const text = message.message.content.map(block => block.text ?? "").join("");
    expect(text.startsWith("Synthetic payment configuration: ")).toBe(true);
    const logged = readFileSync(logPath, "utf8");
    for (const key of keys) {
      expect(logged.includes(key), "Native protocol logs must omit synthetic secret payloads").toBe(false);
      expect(text).toContain(`«redacted ${key.length} chars»`);
    }
    expect(text.match(/«redacted \d+ chars»/g)).toHaveLength(4);
  } finally {
    await fixture.close();
  }
}, 30_000);
