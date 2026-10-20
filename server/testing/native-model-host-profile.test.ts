import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { applyNativeModelHostProfile } from "./native-model-host-profile.ts";

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
function fixture(profile: Record<string, unknown>) {
  const home = mkdtempSync(join(tmpdir(), "openmausbot-verify-data-")); folders.push(home);
  const account = join(home, "synthetic-account"); mkdirSync(account);
  const token = "a".repeat(64); writeFileSync(join(home, ".origin-model-host-fixture"), token);
  writeFileSync(join(account, "origin-model-host-fixture.json"), JSON.stringify(profile));
  return { home, env: { HOME: home, CLAUDE_CONFIG_DIR: account, OMB_TEST_MODEL_HOST_TOKEN: token, OMB_TEST_SEALED_PATH: "1" } as NodeJS.ProcessEnv };
}
test("applies only known fake behavior in a token-marked isolated native home", () => {
  const f = fixture({ version: 1, mode: "usage-limit", auth: "file" });
  applyNativeModelHostProfile(f.env);
  expect(f.env.FAKE_CLAUDE_MODE).toBe("usage-limit"); expect(f.env.FAKE_CLAUDE_AUTH).toBe("file");
});
test("ignores the profile when its random native marker is absent or does not match", () => {
  const f = fixture({ version: 1, mode: "usage-limit" });
  f.env.OMB_TEST_MODEL_HOST_TOKEN = "b".repeat(64); applyNativeModelHostProfile(f.env); expect(f.env.FAKE_CLAUDE_MODE).toBeUndefined();
  delete f.env.OMB_TEST_MODEL_HOST_TOKEN; applyNativeModelHostProfile(f.env); expect(f.env.FAKE_CLAUDE_MODE).toBeUndefined();
});
test("rejects unknown knobs and output paths outside the isolated native home", () => {
  const f = fixture({ version: 1, dump: join(tmpdir(), "outside-native-home.json") });
  expect(() => applyNativeModelHostProfile(f.env)).toThrow(/inside/);
  writeFileSync(join(f.env.CLAUDE_CONFIG_DIR!, "origin-model-host-fixture.json"), JSON.stringify({ version: 1, ANTHROPIC_API_KEY: "must-not-be-set" }));
  expect(() => applyNativeModelHostProfile(f.env)).toThrow(/Unknown/); expect(f.env.ANTHROPIC_API_KEY).toBeUndefined();
});
