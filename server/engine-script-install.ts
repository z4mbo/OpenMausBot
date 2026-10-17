// Security: these are the only installer commands the app runs. Each is copied verbatim from the vendor's own install
// page (docsUrl) and is never read from a request, a response, a driver override or config.json.
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { EngineInstallScript } from "../shared/engine-script-install.ts";
import { stripWorkspaceCredentialEnv } from "./config.ts";
import { augmentedPath } from "./env-path.ts";
import { killCliTree, spawnCli } from "./procs.ts";

export type InstallPlatform = "darwin" | "win32" | "linux";

interface OfficialInstaller {
  source: string;
  docsUrl: string;
  command: Readonly<Partial<Record<InstallPlatform, string>>>;
}

const POSIX_AND_WINDOWS = (posix: string, windows: string) => Object.freeze({ darwin: posix, linux: posix, win32: windows });

export const OFFICIAL_INSTALLERS: Readonly<Record<string, Readonly<OfficialInstaller>>> = Object.freeze({
  cursorAgent: Object.freeze({
    source: "cursor.com",
    docsUrl: "https://cursor.com/docs/cli/installation",
    command: POSIX_AND_WINDOWS("curl https://cursor.com/install -fsS | bash", "irm 'https://cursor.com/install?win32=true' | iex"),
  }),
  droidAgent: Object.freeze({
    source: "app.factory.ai",
    docsUrl: "https://docs.factory.ai/droid-cli/quickstart",
    command: POSIX_AND_WINDOWS("curl -fsSL https://app.factory.ai/cli | sh", "irm https://app.factory.ai/cli/windows | iex"),
  }),
  grokAgent: Object.freeze({
    source: "x.ai",
    docsUrl: "https://docs.x.ai/build/overview",
    command: POSIX_AND_WINDOWS("curl -fsSL https://x.ai/cli/install.sh | bash", "irm https://x.ai/cli/install.ps1 | iex"),
  }),
  hermesAgent: Object.freeze({
    source: "hermes-agent.nousresearch.com",
    docsUrl: "https://hermes-agent.nousresearch.com/docs/getting-started/quickstart",
    command: POSIX_AND_WINDOWS(
      "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
      "iex (irm https://hermes-agent.nousresearch.com/install.ps1)",
    ),
  }),
  kimiAgent: Object.freeze({
    source: "code.kimi.com",
    docsUrl: "https://moonshotai.github.io/kimi-code/en/guides/getting-started.html",
    command: POSIX_AND_WINDOWS(
      "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash",
      "irm https://code.kimi.com/kimi-code/install.ps1 | iex",
    ),
  }),
  qwenAgent: Object.freeze({
    source: "qwen-code-assets.oss-cn-hangzhou.aliyuncs.com",
    docsUrl: "https://qwenlm.github.io/qwen-code-docs/en/users/overview/",
    command: POSIX_AND_WINDOWS(
      "curl -fsSL https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.sh | bash",
      "irm https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.ps1 | iex",
    ),
  }),
  museCode: Object.freeze({
    source: "dev.meta.ai",
    docsUrl: "https://dev.meta.ai/docs/muse-code",
    command: POSIX_AND_WINDOWS("curl -fsSL https://dev.meta.ai/install.sh | sh", "irm https://dev.meta.ai/install.ps1 | iex"),
  }),
});

export function hostInstallPlatform(platform: NodeJS.Platform = process.platform): InstallPlatform | null {
  return platform === "darwin" || platform === "win32" || platform === "linux" ? platform : null;
}

export function officialInstallScript(driverKind: string, platform: InstallPlatform | null = hostInstallPlatform()): EngineInstallScript | null {
  if (!platform || !Object.hasOwn(OFFICIAL_INSTALLERS, driverKind)) return null;
  const installer = OFFICIAL_INSTALLERS[driverKind]!;
  const command = installer.command[platform];
  return command ? { command, source: installer.source, docsUrl: installer.docsUrl } : null;
}

/** The system shell by absolute path, so nothing on the augmented PATH can stand in for it. No elevation, no profile. */
export function installerArgv(command: string, platform: InstallPlatform, env: NodeJS.ProcessEnv = process.env): { cli: string; args: string[] } {
  if (platform === "win32") {
    const powershell = join(env.SystemRoot ?? env.windir ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    return { cli: powershell, args: ["-NoProfile", "-NonInteractive", "-Command", command] };
  }
  return { cli: "/bin/sh", args: ["-c", command] };
}

export interface InstallerRun {
  done: Promise<number | null>;
  stop(): Promise<boolean>;
}

export type InstallerRunner = (script: EngineInstallScript, platform: InstallPlatform, onOutput: (chunk: string) => void) => InstallerRun;

export const runOfficialInstaller: InstallerRunner = (script, platform, onOutput) => {
  const env: Record<string, string | undefined> = { ...process.env, PATH: augmentedPath(), NO_COLOR: "1" };
  stripWorkspaceCredentialEnv(env);
  const { cli, args } = installerArgv(script.command, platform);
  const child = spawnCli(cli, args, { env, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.end();
  const receive = (chunk: Buffer) => onOutput(stripVTControlCharacters(chunk.toString("utf8")));
  child.stdout.on("data", receive);
  child.stderr.on("data", receive);
  const done = new Promise<number | null>((resolveRun, rejectRun) => {
    child.once("error", (error: NodeJS.ErrnoException) => {
      rejectRun(new Error(error.code === "ENOENT" ? `${cli} is not available on this computer.` : `The installer could not start: ${error.message}`));
    });
    child.once("close", (code) => resolveRun(code));
  });
  return { done, stop: () => killCliTree(child) };
};
