import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = fileURLToPath(new URL("..", import.meta.url));
const flag = "--origin-cloud-entry-fixture";
const baseline = "87ff77be5ea79272175219d479b9a8017b4e8fcc";
const sha = value => createHash("sha256").update(value).digest("hex");
if (process.versions.electron && process.argv.includes(flag)) {
  const { app, BrowserWindow, ipcMain, Menu, session } = await import("electron");
  const environments = createRequire(import.meta.url)("../electron/environments.cjs");
  const [configPath] = process.argv.slice(process.argv.indexOf(flag) + 1);
  const { url, output, fixtureOrigin } = JSON.parse(readFileSync(configPath, "utf8"));
  console.log(JSON.stringify({ fixtureEntry: true, output }));
  const origin = new URL(url).origin;
  app.setName("Origin");
  app.setPath("userData", join(output, "user-data"));
  app.setPath("sessionData", join(output, "user-data"));
  app.commandLine.appendSwitch("disable-background-networking");
  app.disableHardwareAcceleration();
  app.on("window-all-closed", () => {});
  let win, menu, currentVersion;
  const results = [], calls = [], blocked = [];
  const state = { environments: [{ id: "synthetic-vps", kind: "remote", name: "Team server", origin: "https://server.example.test" }], activeId: "local" };
  const offer = { recommended: "pro", creditUsd: 5, reminderDays: 2, refundDays: 14, plans: [
    { tier: "pro", label: "Pro", amount: 4900, trialDays: 7, allowances: { cpus: 4, memoryMb: 4096, diskGb: 40, maxDiskGb: 40, computers: 4, computerHours: 200, voiceCharacters: 100000 } },
  ] };
  const handle = (channel, action) => ipcMain.handle(channel, (event, ...args) => {
    assert.equal(event.sender, win.webContents);
    assert.equal(event.senderFrame, win.webContents.mainFrame);
    assert.equal(new URL(event.senderFrame.url).origin, origin);
    calls.push({ version: currentVersion, channel });
    return action(...args);
  });
  handle("workspaces:state", () => environments.workspaceSummary(state));
  handle("environments:state", () => ({ ...state, packaged: true }));
  handle("desktop:skin", () => undefined);
  handle("cloud-account:state", () => ({ status: "signed-out" }));
  handle("cloud-account:offer", () => offer);
  handle("workspaces:menu", () => {
    const chosen = menu.getMenuItemById("workspace-add-cloud") ?? menu.getMenuItemById("workspace-connect");
    chosen.click();
  });
  for (const channel of ["cloud-account:begin", "cloud-account:checkout", "environments:switch", "environments:forget", "environments:add-from-link"]) {
    handle(channel, () => { throw new Error("Fixture refuses account, payment and connection mutations"); });
  }
  void app.whenReady().then(async () => {
    session.defaultSession.webRequest.onBeforeRequest((details, done) => {
      const target = new URL(details.url);
      const allowed = [origin, fixtureOrigin].includes(target.origin) || ["data:", "devtools:"].includes(target.protocol);
      if (!allowed) blocked.push({ origin: target.origin, resourceType: details.resourceType });
      done({ cancel: !allowed });
    });
    try {
      for (const version of ["before", "after"]) {
        currentVersion = version;
        const main = readFileSync(version === "before" ? join(output, "main-before.mjs") : join(root, "electron/main.mjs"), "utf8").replaceAll("\r\n", "\n");
        const between = start => { const from = main.indexOf(start), to = main.indexOf("\n}\n", from); assert(from >= 0 && to > from); return main.slice(from, to + 3); };
        const feature = main.includes("function cloudAccountAvailable()") ? between("function cloudAccountAvailable()") : "";
        const context = vm.createContext({ app: { isPackaged: true, getName: () => app.getName() }, desktopRemoteAccess: false, brandedBuild: false,
          cloudMenuSublabels: () => ({}), workspaceMenuAction: action => action(), openCloudAdd: () => win.webContents.send("app:open-settings", "cloud-add") });
        vm.runInContext(feature + between("function cloudOffersAllowed()") + between("function cloudMenuOptions("), context);
        menu = Menu.buildFromTemplate(environments.workspaceMenuTemplate(state, { ...vm.runInContext("cloudMenuOptions()", context),
          onSwitch: () => { throw new Error("No server switch requested"); }, onForget: () => { throw new Error("No server deletion requested"); },
          onConnect: () => win.webContents.send("workspaces:open-settings", null) }));
        const menuItems = menu.items.map(item => ({ id: item.id, label: item.label, type: item.type }));
        assert.equal(Boolean(menu.getMenuItemById("workspace-add-cloud")), version === "before");
        const preload = version === "before" ? join(output, "preload-before.cjs") : join(root, "electron/preload.cjs");
        win = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true,
          additionalArguments: [`--omb-local-origin=${origin}`, "--omb-company-desktop=1"] } });
        const evaluate = script => win.webContents.executeJavaScript(script, true);
        const waitFor = async script => { for (let attempt = 0; attempt < 240; attempt++) { if (await evaluate(script)) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error("Missing expected renderer state"); };
        for (const theme of ["dark", "light"]) for (const width of [1440, 375]) {
          win.setSize(width, width === 375 ? 900 : 1000);
          await win.loadURL(`${url}?theme=${theme}`);
          await waitFor('Boolean(document.querySelector("[data-tour=server-switcher]"))');
          await evaluate('document.querySelector("[data-tour=server-switcher]").click()');
          await waitFor(version === "before" ? 'Boolean(document.querySelector("[data-cloud-add=offer-trial]"))' : 'document.body.innerText.includes("Server address or pairing link")');
          await evaluate("document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))");
          const proof = await evaluate(`({cloudAccount:typeof window.ogb.cloudAccount,cloudPlan:typeof window.ogb.cloudPlan,servers:typeof window.ogb.environments,copy:typeof window.ogb.cloudMove,dialog:!!document.querySelector('[data-cloud-add-dialog]'),overflow:document.documentElement.scrollWidth>innerWidth,text:document.body.innerText})`);
          assert.equal(proof.overflow, false);
          assert.equal(proof.cloudAccount, version === "before" ? "object" : "undefined");
          assert.equal(proof.dialog, version === "before");
          assert.equal(proof.servers, "object");
          assert.equal(proof.copy, "object");
          if (version === "after") assert(!proof.text.includes("$49") && !proof.text.includes("MausBot Cloud"));
          const name = `${version}-${width}-${theme}.png`;
          const image = (await win.webContents.capturePage()).toPNG();
          writeFileSync(join(output, name), image, { flag: "wx" });
          results.push({ version, theme, width, menuItems, ...proof, screenshot: { name, bytes: image.length, sha256: sha(image) }, mainSha256: sha(main), preloadSha256: sha(readFileSync(preload)) });
        }
        win.destroy(); win = null;
      }
      assert.equal(calls.filter(call => ["cloud-account:begin", "cloud-account:checkout", "environments:switch", "environments:forget", "environments:add-from-link"].includes(call.channel)).length, 0);
      assert.equal(calls.filter(call => call.version === "after" && call.channel.startsWith("cloud-account:")).length, 0);
      writeFileSync(join(output, "browser-proof.json"), JSON.stringify({ baseline, observedAt: new Date().toISOString(), results, calls, blocked, nativeMenuConstructed:true,
        nativePopupManuallyDriven:false, packagedProductIdentitySimulated:true, actualRendererAndPreload:true, productionDataUsed:false, providerRequests:0, limitations:["Hidden disposable Electron browser windows, not the installed Origin executable.","The native menu factory and action run; OS menu popup geometry is not tested.","Synthetic upstream offer and saved server; no payment, provider, pairing or real account operation."] }, null, 2) + "\n", { flag: "wx" });
      app.exit(0);
    } catch (error) { console.error(error); if (win && !win.isDestroyed()) win.destroy(); app.exit(1); }
  });
} else {
  const { launchVerificationServer } = await import("./control-omb.ts");
  const { mountPreview } = await import("./testing/preview-fixture.ts");
  const output = mkdtempSync(join(tmpdir(), "origin-cloud-entry-033-"));
  for (const folder of ["home", "user-data", "temp"]) mkdirSync(join(output, folder));
  for (const [path, name] of [["electron/main.mjs", "main-before.mjs"], ["electron/preload.cjs", "preload-before.cjs"]]) {
    writeFileSync(join(output, name), execFileSync("git", ["show", `${baseline}:${path}`], { cwd: root }), { flag: "wx" });
  }
  const fixture = await launchVerificationServer();
  let preview;
  try {
    preview = await mountPreview(fixture, { entry: "/scripts/testing/origin-cloud-entry-preview.tsx", route: "/__origin-cloud-entry.html", title: "Origin cloud entry fixture", hmr: false });
    console.log(JSON.stringify({ previewUrl: preview.previewUrl, evidence: output, fixture: fixture.info }));
    const entry = join(output, "electron-entry.mjs");
    writeFileSync(entry, `try { await import(${JSON.stringify(import.meta.url)}); } catch (error) { console.error(error); process.exit(1); }\n`, { flag: "wx" });
    const configPath = join(output, "fixture-config.json");
    writeFileSync(configPath, JSON.stringify({ url: preview.previewUrl, output, fixtureOrigin: fixture.info.url }), { flag: "wx" });
    const child = spawn(createRequire(import.meta.url)("electron"), [entry, flag, configPath], { cwd: root, windowsHide: true,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: join(output, "home"), USERPROFILE: join(output, "home"), APPDATA: join(output, "user-data"), LOCALAPPDATA: join(output, "user-data"), TEMP: join(output, "temp"), TMP: join(output, "temp"), TMPDIR: join(output, "temp") }, stdio: ["ignore", "pipe", "pipe"] });
    for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => appendFileSync(join(output, "electron.log"), bytes));
    const stop = () => child.kill("SIGTERM");
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    const timer = setTimeout(stop, 180000);
    const exit = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", code => resolve(code)); }).finally(() => { clearTimeout(timer); process.off("SIGINT", stop); process.off("SIGTERM", stop); });
    assert.equal(exit, 0, `Fixture failed; inspect ${output}`);
    assert.equal(JSON.parse(readFileSync(join(output, "browser-proof.json"))).results.length, 8);
    console.log(JSON.stringify({ passed: true, evidence: output, screenshots: 8 }));
  } finally { await preview?.close(); await fixture.close(); }
}
