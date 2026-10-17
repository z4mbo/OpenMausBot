import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { waitForExit } from "../../server/testing/cleanup.ts";

export function spawnUiLauncher(args: string[], env: NodeJS.ProcessEnv = process.env): ChildProcess {
  const launcher = new URL("./control-omb-ui.ts", import.meta.url).href;
  const bootstrap = `import { launchUi } from ${JSON.stringify(launcher)};
    process.on('message', message => { if (message === 'stop') process.emit('SIGINT'); });
    try { await launchUi(${JSON.stringify(args)}); } finally { if (process.connected) process.disconnect(); }`;
  return spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", bootstrap], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)), env,
    stdio: ["ignore", "pipe", "pipe", "ipc"], detached: process.platform !== "win32", windowsHide: true,
  });
}

export async function stopUiLauncher(child: ChildProcess | undefined): Promise<void> {
  // Windows does not deliver a catchable SIGINT through ChildProcess.kill().
  if (child?.connected) await new Promise<void>((resolve) => { child.send("stop", () => resolve()); });
  await waitForExit(child, { graceMs: 30_000 });
}
