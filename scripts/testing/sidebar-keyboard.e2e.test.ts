import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePath } from "vite";
import { expect, it } from "vitest";
import { connectCdp, type Cdp } from "../../server/browser-sites.ts";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { launchVerificationServer } from "../control-omb.ts";
import { mountPreview, REPO_ROOT } from "./preview-fixture.ts";

const enabled = process.env.OMB_HEADER_UI_E2E === "1";

async function until<T>(read: () => Promise<T>, accepts: (value: T) => boolean, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
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
    const baseline = process.env.OMB_HEADER_UI_BASELINE;
    if (baseline && !/^[a-f0-9]{40}$/.test(baseline)) throw new Error("OMB_HEADER_UI_BASELINE must be a full Git commit hash");
    const frozen = new Map(baseline ? ["src/components/Sidebar.tsx", "src/components/SidebarFooterNav.tsx", "src/styles.css"].map(path => [normalizePath(join(REPO_ROOT, path)), execFileSync("git", ["show", `${baseline}:${path}`], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 })]) : []);
    preview = await mountPreview(fixture, {
      entry: "/scripts/testing/origin-header-preview.tsx", route: "/__origin-header.html", title: "Synthetic sidebar keyboard fixture", hmr: false,
      cacheDir: join(fixture.info.dataDir, "vite-keyboard"),
      plugins: [{ name: "frozen-sidebar-keyboard", enforce: "pre", load(id) { return frozen.get(normalizePath(id.split("?")[0])); } }],
      aliases: [
        { find: /^@\/lib\/origin-cloud$/, replacement: fileURLToPath(new URL("./origin-header-cloud.ts", import.meta.url)) },
        { find: /^@\/lib\/interface-mode$/, replacement: fileURLToPath(new URL("./origin-header-mode.ts", import.meta.url)) },
        { find: /^@\//, replacement: `${join(REPO_ROOT, "src").replaceAll("\\", "/")}/` },
      ],
      extraRoutes: [{ path: "/__origin-header-fixture.json", handler: (_request, response) => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ version: "keyboard", synthetic: true })); } }],
    });
    browser = spawn(executable, ["--headless=new", "--no-first-run", "--disable-background-networking", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore", windowsHide: true });
    const portFile = join(profile, "DevToolsActivePort");
    await until(async () => existsSync(portFile), Boolean, 20_000);
    const [port, endpoint] = readFileSync(portFile, "utf8").trim().split("\n");
    cdp = await connectCdp(`ws://127.0.0.1:${port}${endpoint}`);
    const target = await cdp.send("Target.createTarget", { url: "about:blank" }) as { targetId: string };
    const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true }) as { sessionId: string };
    let pageTarget = target.targetId;
    let sessionId = attached.sessionId;
    const send = async (method: string, params: Record<string, unknown> = {}) => {
      try { return await cdp!.send(method, params, sessionId); }
      catch (cause) { throw new Error(`Keyboard fixture ${method} failed`, { cause }); }
    };
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
    await until(() => evaluate<boolean>(`document.querySelector('[data-tour="server-switcher"]')?.textContent === 'This computer'`), Boolean, 20_000);
    await evaluate("document.fonts.ready.then(() => true)");
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
    for (const density of ["comfortable", "compact"]) for (const width of [240, 272, 320, 375]) for (const mode of ["advanced", "simple"]) {
      await cdp.send("Target.closeTarget", { targetId: pageTarget });
      const next = await cdp.send("Target.createTarget", { url: "about:blank" }) as { targetId: string };
      pageTarget = next.targetId;
      const attached = await cdp.send("Target.attachToTarget", { targetId: pageTarget, flatten: true }) as { sessionId: string };
      sessionId = attached.sessionId;
      await send("Page.enable");
      await send("Runtime.enable");
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }] });
      await send("Emulation.setDeviceMetricsOverride", { width: width === 375 ? 375 : 1280, height: 812, deviceScaleFactor: 1, mobile: false });
      const url = `${preview.previewUrl}?platform=win&width=${width === 375 ? 320 : width}&mode=${mode}&density=${density}&theme=dark`;
      await send("Page.navigate", { url });
      await until(() => evaluate<boolean>(`location.href === ${JSON.stringify(url)} && document.querySelector('[data-tour="server-switcher"]')?.textContent === 'This computer'`), Boolean, 20_000);
      await evaluate("document.fonts.ready.then(() => true)");
      const footer = await evaluate<{ contained: boolean; aligned: boolean; labels: Array<string | null> }>(`(() => { const sidebar=document.querySelector('[data-sidebar]').getBoundingClientRect(); const apps=document.querySelector('[data-sidebar-nav="apps"]'); const buttons=[...apps.parentElement.querySelectorAll('button')],boxes=buttons.map(button=>button.getBoundingClientRect()); return {contained:boxes.every(box=>box.width>0&&box.left>=sidebar.left&&box.right<=sidebar.right),aligned:boxes.length!==6||boxes[0].top===boxes[3].top||boxes.slice(0,3).every((box,index)=>Math.abs((box.left+box.width/2)-(boxes[index+3].left+boxes[index+3].width/2))<0.1),labels:buttons.map(button=>button.getAttribute('aria-label'))}; })()`);
      expect(footer.contained, `${density}/${width}/${mode}`).toBe(true);
      expect(footer.aligned, `${density}/${width}/${mode}`).toBe(true);
      expect(footer.labels).toEqual(mode === "advanced" ? ["Routines", "Triggers", "Team map", "Active Threads", "New or share", "Apps"] : ["New or share", "Apps"]);
    }
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
}, 90_000);
