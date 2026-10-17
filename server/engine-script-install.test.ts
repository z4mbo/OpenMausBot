import { describe, expect, it } from "vitest";
import { BUILT_IN_DRIVERS } from "./drivers/builtIn.ts";
import { OFFICIAL_INSTALLERS, installerArgv, officialInstallScript, type InstallPlatform } from "./engine-script-install.ts";

const PLATFORMS: InstallPlatform[] = ["darwin", "linux", "win32"];

describe("official engine installers", () => {
  it("download only from the vendor domain they name, over HTTPS", () => {
    for (const [driverKind, installer] of Object.entries(OFFICIAL_INSTALLERS)) {
      for (const platform of PLATFORMS) {
        const command = installer.command[platform];
        if (!command) continue;
        const urls = command.match(/https?:\/\/[^\s'")]+/g) ?? [];
        expect(urls, `${driverKind} ${platform}`).toHaveLength(1);
        const url = new URL(urls[0]!);
        expect(url.protocol, `${driverKind} ${platform}`).toBe("https:");
        expect(url.hostname, `${driverKind} ${platform}`).toBe(installer.source);
      }
    }
  });

  it("use only the vendor's documented pipe into the user's own shell, without elevation", () => {
    for (const installer of Object.values(OFFICIAL_INSTALLERS)) {
      for (const platform of PLATFORMS) {
        const command = installer.command[platform];
        if (!command) continue;
        expect(command).not.toMatch(/\bsudo\b|RunAs|Start-Process|-Verb\b|[;&`]|\$\(/);
        if (platform === "win32") expect(command).toMatch(/^(irm \S+ \| iex|iex \(irm \S+\))$/);
        else expect(command).toMatch(/^curl (-fsSL \S+|\S+ -fsS) \| (bash|sh)$/);
      }
    }
  });

  it("match the copyable command each engine's setup card shows", () => {
    for (const [driverKind, installer] of Object.entries(OFFICIAL_INSTALLERS)) {
      const driver = BUILT_IN_DRIVERS.find((candidate) => candidate.driverKind === driverKind);
      expect(driver, driverKind).toBeDefined();
      for (const platform of PLATFORMS) expect(driver!.install?.command?.[platform], `${driverKind} ${platform}`).toBe(installer.command[platform]);
    }
  });

  it("cover script-installed engines only, never an npm or app-managed one", () => {
    expect(Object.keys(OFFICIAL_INSTALLERS).sort()).toEqual(
      ["cursorAgent", "droidAgent", "grokAgent", "hermesAgent", "kimiAgent", "museCode", "qwenAgent"],
    );
    for (const driverKind of ["claudeAgent", "codex", "antigravity", "__proto__", "constructor", "toString"]) {
      expect(officialInstallScript(driverKind, "linux"), driverKind).toBeNull();
    }
    expect(officialInstallScript("grokAgent", null)).toBeNull();
    expect(officialInstallScript("grokAgent", "win32")).toEqual({
      command: "irm https://x.ai/cli/install.ps1 | iex",
      source: "x.ai",
      docsUrl: "https://docs.x.ai/build/overview",
    });
  });

  it("cannot be changed at runtime", () => {
    expect(Object.isFrozen(OFFICIAL_INSTALLERS)).toBe(true);
    for (const installer of Object.values(OFFICIAL_INSTALLERS)) {
      expect(Object.isFrozen(installer)).toBe(true);
      expect(Object.isFrozen(installer.command)).toBe(true);
    }
  });

  it("runs the command through the system shell by absolute path, with no profile", () => {
    expect(installerArgv("curl -fsSL https://x.ai/cli/install.sh | bash", "linux")).toEqual({
      cli: "/bin/sh",
      args: ["-c", "curl -fsSL https://x.ai/cli/install.sh | bash"],
    });
    const windows = installerArgv("irm https://x.ai/cli/install.ps1 | iex", "win32", { SystemRoot: "C:\\Windows" });
    expect(windows.cli).toMatch(/^C:\\Windows[\\/]System32[\\/]WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/);
    expect(windows.args).toEqual(["-NoProfile", "-NonInteractive", "-Command", "irm https://x.ai/cli/install.ps1 | iex"]);
  });
});
