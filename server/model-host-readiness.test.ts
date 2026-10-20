import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { modelHostReady, modelHostVerificationReady } from "./testing/model-host-readiness.ts";

const cleanups: Array<() => void> = [];
afterEach(() => { vi.unstubAllEnvs(); for (const close of cleanups.splice(0)) close(); });

function sealedFixture() {
  const home = mkdtempSync(join(tmpdir(), "openmausbot-verify-data-readiness-"));
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  const token = "a".repeat(64);
  vi.stubEnv("HOME", home); vi.stubEnv("USERPROFILE", home); vi.stubEnv("OMB_TEST_MODEL_HOST_TOKEN", token);
  writeFileSync(join(home, ".origin-model-host-fixture"), token);
  return home;
}

describe("sealed hosted-model verification readiness", () => {
  it("enables production account opt-in without impersonating a fixture", () => {
    vi.stubEnv("OMB_TEST_MODEL_HOST_TOKEN", undefined);
    expect(modelHostReady(tmpdir(), {})).toBe(true);
    expect(modelHostVerificationReady(tmpdir(), {})).toBe(false);
  });

  it.each(["", "malformed"])("fails closed when the test mode token is present but invalid: %j", token => {
    const home = sealedFixture();
    vi.stubEnv("OMB_TEST_MODEL_HOST_TOKEN", token);
    expect(modelHostReady(home, {})).toBe(false);
  });

  it("requires the marker and home to match in test mode", () => {
    const home = sealedFixture();
    const instances = { claude: { driver: "claudeAgent", config: {
      cli: fileURLToPath(new URL("./testing/fake-claude-cli.ts", import.meta.url)),
    } } };
    expect(modelHostReady(home, instances)).toBe(true);
    writeFileSync(join(home, ".origin-model-host-fixture"), "b".repeat(64));
    expect(modelHostReady(home, instances)).toBe(false);
    writeFileSync(join(home, ".origin-model-host-fixture"), "a".repeat(64));
    vi.stubEnv("HOME", tmpdir()); vi.stubEnv("USERPROFILE", tmpdir());
    expect(modelHostReady(home, instances)).toBe(false);
  });

  it("admits the launcher fake Claude adapter only with its sealed home", () => {
    const home = sealedFixture();
    expect(modelHostVerificationReady(home, { claude: { driver: "claudeAgent", config: {
      cli: fileURLToPath(new URL("./testing/fake-claude-cli.ts", import.meta.url)),
    } } })).toBe(true);
  });

  it("does not admit an API adapter merely because it has an unused fake CLI property", () => {
    const home = sealedFixture();
    expect(modelHostVerificationReady(home, { api: { driver: "openai-compat", config: {
      cli: fileURLToPath(new URL("./testing/fake-claude-cli.ts", import.meta.url)),
      baseUrl: "https://api.openai.com/v1",
    } } })).toBe(false);
  });

  it("requires each fake CLI to belong to its declared adapter", () => {
    const home = sealedFixture();
    expect(modelHostVerificationReady(home, { claude: { driver: "claudeAgent", config: {
      cli: fileURLToPath(new URL("./testing/fake-codex-app-server.ts", import.meta.url)),
    } } })).toBe(false);
  });
});
