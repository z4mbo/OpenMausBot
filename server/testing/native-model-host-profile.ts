import { readFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

export function applyNativeModelHostProfile(env: NodeJS.ProcessEnv): void {
  const home = env.HOME, account = env.CLAUDE_CONFIG_DIR, token = env.OMB_TEST_MODEL_HOST_TOKEN;
  if (!home || !account || !isAbsolute(home) || !isAbsolute(account) || !basename(home).startsWith("openmausbot-verify-data-") || env.OMB_TEST_SEALED_PATH !== "1" || !token || !/^[a-f0-9]{64}$/.test(token)) return;
  const within = (path: string) => { const value = relative(resolve(home), resolve(path)); return value !== ".." && !value.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(value); };
  if (!within(account)) throw new Error("The native model-host fake account must stay inside its isolated home");
  let profile: Record<string, unknown>;
  try {
    if (readFileSync(join(home, ".origin-model-host-fixture"), "utf8").trim() !== token) return;
    profile = JSON.parse(readFileSync(join(account, "origin-model-host-fixture.json"), "utf8"));
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  if (!profile || typeof profile !== "object" || Array.isArray(profile) || profile.version !== 1) throw new Error("Invalid native model-host fake profile");
  const allowed = new Set(["version", "mode", "auth", "roomPlan", "prompts", "dump"]);
  if (Object.keys(profile).some(key => !allowed.has(key))) throw new Error("Unknown native model-host fake profile setting");
  if (profile.mode !== undefined) {
    if (!["happy", "usage-limit", "usage-limit-after-text", "usage-limit-after-tool"].includes(String(profile.mode))) throw new Error("Unsupported native model-host fake mode");
    env.FAKE_CLAUDE_MODE = String(profile.mode);
  }
  if (profile.auth !== undefined) {
    if (!["file", "api-key"].includes(String(profile.auth))) throw new Error("Unsupported native model-host fake authentication");
    env.FAKE_CLAUDE_AUTH = String(profile.auth);
  }
  for (const [field, key] of [["roomPlan", "FAKE_CLAUDE_ROOM_PLAN"], ["prompts", "FAKE_CLAUDE_PROMPTS"], ["dump", "FAKE_CLAUDE_DUMP"]]) {
    const path = profile[field];
    if (path === undefined) continue;
    if (typeof path !== "string" || !isAbsolute(path) || !within(path)) throw new Error("Native model-host fake output must stay inside its isolated home");
    env[key] = path;
  }
}
