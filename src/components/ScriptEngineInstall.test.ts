import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { InstanceInfo } from "@/state/store";
import { scriptInstallOffered } from "./EngineSetup";
import { ScriptInstallConfirmDetails } from "./ScriptEngineInstall";

const SCRIPT = {
  command: "irm 'https://cursor.com/install?win32=true' | iex",
  source: "cursor.com",
  docsUrl: "https://cursor.com/docs/cli/installation",
};

const cursor = (patch: Partial<InstanceInfo> = {}): InstanceInfo => ({
  instanceId: "cursor", driverKind: "cursorAgent", displayName: "Cursor",
  install: { command: { win32: SCRIPT.command }, docsUrl: SCRIPT.docsUrl, script: SCRIPT },
  snapshot: { state: "unavailable", reason: "cursor-agent was not found" },
  models: { default: "m", options: [] },
  ...patch,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("official installer offer", () => {
  it("is made only in the desktop app on the computer that runs the engine", () => {
    vi.stubGlobal("window", { ogb: { openInstallTerminal: vi.fn() } });
    expect(scriptInstallOffered(cursor(), false)).toBe(true);
    expect(scriptInstallOffered(cursor(), true)).toBe(false);
    vi.stubGlobal("window", { ogb: { openInstallTerminal: vi.fn(), remoteClient: { active: true } } });
    expect(scriptInstallOffered(cursor(), false)).toBe(false);
    vi.stubGlobal("window", {});
    expect(scriptInstallOffered(cursor(), false)).toBe(false);
  });

  it("is not made once the engine is installed, or without an allow-listed installer", () => {
    vi.stubGlobal("window", { ogb: { openInstallTerminal: vi.fn() } });
    expect(scriptInstallOffered(cursor({ snapshot: { state: "available", authenticated: false } }), false)).toBe(false);
    expect(scriptInstallOffered(cursor({ install: { command: { win32: SCRIPT.command }, docsUrl: SCRIPT.docsUrl } }), false)).toBe(false);
  });

  it("shows the exact command, its source and the vendor's guide before anything runs", () => {
    setLocale("en");
    const html = renderToStaticMarkup(createElement(ScriptInstallConfirmDetails, { script: SCRIPT }));
    expect(html).toContain("irm &#x27;https://cursor.com/install?win32=true&#x27; | iex");
    expect(html).toContain("Downloaded from");
    expect(html).toContain(">cursor.com<");
    expect(html).toContain('href="https://cursor.com/docs/cli/installation"');
  });
});
