import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { InstanceConfigMap } from "../contracts.ts";

export function modelHostReady(dataDir: string, instances: InstanceConfigMap): boolean {
  return process.env.OMB_TEST_MODEL_HOST_TOKEN === undefined || modelHostVerificationReady(dataDir, instances);
}

export function modelHostVerificationReady(dataDir: string, instances: InstanceConfigMap): boolean {
  const token = process.env.OMB_TEST_MODEL_HOST_TOKEN;
  if (!token || !/^[a-f0-9]{64}$/.test(token) || !basename(dataDir).startsWith("openmausbot-verify-data-") || resolve(homedir()) !== resolve(dataDir)) return false;
  try {
    if (readFileSync(join(dataDir, ".origin-model-host-fixture"), "utf8").trim() !== token) return false;
    const known = new Map(Object.entries({ claudeAgent: "fake-claude-cli.ts", codex: "fake-codex-app-server.ts", clineAgent: "fake-acp-cli.ts" })
      .map(([driver, name]) => [driver, realpathSync(fileURLToPath(new URL(name, import.meta.url)))]));
    const providers = Object.values(instances);
    return providers.length > 0 && providers.every(instance => {
      const config = instance.config as { cli?: unknown } | undefined;
      return typeof config?.cli === "string" && known.get(instance.driver) === realpathSync(config.cli);
    });
  } catch { return false; }
}
