import { describe, expect, it } from "vitest";
import { codexLoginDetails } from "./codex-login.ts";
import type { execCli } from "../procs.ts";

describe("Codex login billing facts", () => {
  it.each([
    ["Logged in using ChatGPT", "subscription"],
    ["Logged in using an API key", "metered"],
    ["Logged in using API key", "metered"],
    ["Logged in using an unknown method", undefined],
    ["Not logged in", undefined],
  ] as const)("classifies %s without reading account credentials", async (text, billing) => {
    const run = ((_cli, _args, _options, done) => done(null, "", `${text}\n`)) as typeof execCli;
    const result = await codexLoginDetails("fixture", {}, run);
    expect(result.billing).toBe(billing);
    expect(JSON.stringify(result)).not.toContain(text);
  });
});
