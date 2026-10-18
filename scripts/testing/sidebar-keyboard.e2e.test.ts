import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { connectCdp, type Cdp } from "../../server/browser-sites.ts";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { launchVerificationServer } from "../control-omb.ts";
import { mountPreview, REPO_ROOT } from "./preview-fixture.ts";

const enabled = process.env.OMB_HEADER_UI_E2E === "1";

async function until<T>(read: () => Promise<T>, accepts: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5_000;
  let value: T;
  do {
    value = await read();
    if (accepts(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  assert.ok(accepts(value), `Keyboard fixture did not settle: ${JSON.stringify(value)}`);
  return value;
}

(enabled ? it : it.skip).each([false, true])("keeps the account menu keyboard accessible (reduced motion: %s)", async reduced => {
  const executable = process.env.OMB_HEADER_CHROME;
  if (!executable || !existsSync(executable)) throw new Error("Set OMB_HEADER_CHROME to an installed Chrome for Testing executable");
  const fixture = await launchVerificationServer();
  let browser: ChildProcess | undefined;
  let cdp: Cdp | undefined;
  let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
  let browserExited = false;
  const profile = await mkdtemp(join(tmpdir(), "origin-header-keyboard-"));
  try {
    preview = await mountPreview(fixture, {
      entry: "/scripts/testing/origin-header-preview.tsx", route: "/__origin-header.html", title: "Synthetic sidebar keyboard fixture", hmr: false,
      cacheDir: join(fixture.info.dataDir, "vite-keyboard"),
      aliases: [
        { find: /^@\/lib\/origin-cloud$/, replacement: fileURLToPath(new URL("./origin-header-cloud.ts", import.meta.url)) },
        { find: /^@\//, replacement: `${join(REPO_ROOT, "src").replaceAll("\\", "/")}/` },
      ],
      extraRoutes: [{ path: "/__origin-header-fixture.json", handler: (_request, response) => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ version: "keyboard", synthetic: true })); } }],
    });
    browser = spawn(executable, ["--headless=new", "--no-first-run", "--disable-background-networking", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore", windowsHide: true });
    const portFile = join(profile, "DevToolsActivePort");
    await until(async () => existsSync(portFile), Boolean);
    const [port, endpoint] = readFileSync(portFile, "utf8").trim().split("\n");
    cdp = await connectCdp(`ws://127.0.0.1:${port}${endpoint}`);
    const target = await cdp.send("Target.createTarget", { url: "about:blank" }) as { targetId: string };
    const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true }) as { sessionId: string };
    const send = (method: string, params: Record<string, unknown> = {}) => cdp!.send(method, params, attached.sessionId);
    const evaluate = async <T,>(expression: string): Promise<T> => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }) as { result: { value: T }; exceptionDetails?: unknown };
      if (result.exceptionDetails) throw new Error("Synthetic keyboard page evaluation failed");
      return result.result.value;
    };
    const key = async (name: string, code: number) => {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, windowsVirtualKeyCode: code, ...(name === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}) });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code });
    };
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }] });
    await send("Page.navigate", { url: `${preview.previewUrl}?platform=win&width=240&mode=advanced&theme=dark` });
    await until(() => evaluate<boolean>(`document.querySelector('[data-tour="server-switcher"]')?.textContent === 'This computer'`), Boolean);
    await evaluate("document.fonts.ready");
    await evaluate(`document.querySelector('[aria-label="Open account menu"]').focus()`);
    await key("Enter", 13);
    await until(() => evaluate<string | null>("document.activeElement?.getAttribute('data-menu-key')"), value => value === "origin-account");
    await key("ArrowDown", 40);
    expect(await evaluate("document.activeElement?.getAttribute('data-menu-key')")).toBe("origin-account-settings");
    await key("End", 35);
    expect(await evaluate("document.activeElement?.getAttribute('data-menu-key')")).toBe("origin-sign-out");
    await key("ArrowDown", 40);
    expect(await evaluate("document.activeElement?.getAttribute('data-menu-key')")).toBe("origin-account");
    await key("Escape", 27);
    await until(() => evaluate<boolean>("document.querySelector('[data-sidebar-popover-menu]') === null"), Boolean);
    expect(await evaluate("document.activeElement?.getAttribute('aria-label')")).toBe("Open account menu");
    await key("Tab", 9);
    expect(await evaluate("document.activeElement?.getAttribute('aria-label')")).toBe("Search bots and messages");
    expect(await evaluate("document.querySelector('[role=dialog]') === null")).toBe(true);
  } finally {
    if (cdp) await cdp.send("Browser.close").catch(() => {});
    cdp?.close();
    await waitForExit(browser, { graceMs: 2_000 });
    browserExited = !browser || browser.exitCode !== null || browser.signalCode !== null;
    const target = resolve(profile);
    assert.equal(dirname(target), resolve(tmpdir())); assert.ok(basename(target).startsWith("origin-header-keyboard-"));
    if (browserExited) await rm(target, { recursive: true, force: true });
    else console.warn("Owned Chrome did not exit; its isolated profile was retained");
    await preview?.close();
    await fixture.close();
  }
  expect(browserExited).toBe(true);
}, 45_000);
