import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import environments from "./environments.cjs";

const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const between = (start, end = "\n}\n") => {
  const from = main.indexOf(start), to = main.indexOf(end, from);
  assert(from >= 0 && to > from, start);
  return main.slice(from, to + end.length);
};
function policy({ name = "Origin", packaged = true, remote = false } = {}) {
  const context = vm.createContext({ app: { isPackaged: packaged, getName: () => name }, desktopRemoteAccess: remote, brandedBuild: false,
    cloudMenuSublabels: () => ({}), workspaceMenuAction: action => action(), openCloudAdd: () => { throw new Error("Unexpected commercial action"); } });
  const feature = main.includes("function cloudAccountAvailable()") ? between("function cloudAccountAvailable()") : "";
  vm.runInContext(feature + between("function cloudOffersAllowed()") + between("function cloudMenuOptions("), context);
  return context;
}

test("Origin's default branding does not enable the upstream paid Cloud menu", () => {
  for (const name of ["Origin", "origin", "My Origin workspace"]) {
    const context = policy({ name });
    assert.equal(vm.runInContext("cloudOffersAllowed()", context), false, name);
    const state = { environments: [{ id: "vps", name: "Team server", origin: "https://server.example.test" }], activeId: "local" };
    const calls = [];
    const options = vm.runInContext("cloudMenuOptions()", context);
    const items = environments.workspaceMenuTemplate(state, { ...options, onSwitch: id => calls.push(["switch", id]), onConnect: () => calls.push(["connect"]), onForget: id => calls.push(["forget", id]) });
    assert.equal(items.some(item => item.id === "workspace-add-cloud"), false);
    items.find(item => item.id === "workspace-connect").click();
    items.find(item => item.id === "workspace-vps").click();
    assert.deepEqual(calls, [["connect"], ["switch", "vps"]]);
    assert.equal(state.activeId, "local");
  }
});

test("the upstream Cloud implementation remains opt-in to its own packaged product", () => {
  assert.equal(vm.runInContext("cloudOffersAllowed()", policy({ name: "OpenMausBot" })), true);
  for (const options of [{ name: "OpenMausBot", packaged: false }, { name: "OpenMausBot", remote: true }]) {
    assert.equal(vm.runInContext("cloudOffersAllowed()", policy(options)), false);
  }
});

function preload({ company = true, upstream = false, remoteClient = false } = {}) {
  let bridge;
  const calls = [];
  const origin = "http://127.0.0.1:49231";
  vm.runInNewContext(readFileSync(new URL("./preload.cjs", import.meta.url), "utf8"), {
    process: { platform: "win32", argv: [`--omb-local-origin=${origin}`, ...(company ? ["--omb-company-desktop=1"] : []), ...(upstream ? ["--omb-vendor-cloud=1"] : []), ...(remoteClient ? ["--openmausbot-remote-client"] : [])] },
    location: { origin }, TextEncoder, localStorage: { getItem: () => null },
    require: () => ({ webUtils: {}, contextBridge: { exposeInMainWorld: (_key, value) => { bridge = value; } }, ipcRenderer: { on() {}, removeListener() {}, send() {}, invoke: (...args) => { calls.push(args); return Promise.resolve({}); } } }),
  });
  return { bridge, calls };
}

test("Origin keeps its server and organization controls without exposing upstream billing", async () => {
  const { bridge, calls } = preload();
  for (const key of ["cloudAccount", "cloudPlan", "cloudLending"]) assert.equal(bridge[key], undefined, key);
  for (const key of ["environments", "workspaces", "organization", "companyBackups", "cloudMove"]) assert(bridge[key], key);
  await bridge.workspaces.menu();
  await bridge.environments.switch("vps");
  await bridge.cloudMove.state("vps");
  assert.deepEqual(calls, [["workspaces:menu"], ["environments:switch", "vps"], ["cloud-move:state", "vps"]]);
});

test("upstream compatibility bridges require both native capabilities", () => {
  assert(preload({ upstream: true }).bridge.cloudAccount);
  assert.equal(preload({ company: false, upstream: true }).bridge.cloudAccount, undefined);
  assert.equal(preload({ upstream: true, remoteClient: true }).bridge.cloudAccount, undefined);
});

test("Origin startup does not restore an unrelated upstream account", async () => {
  const calls = [];
  const context = vm.createContext({ cloudAccountAvailable: () => false, cloudAccountRestoring: false, cloudAccountStarted: Promise.resolve(),
    ensureCloudAccount: () => { calls.push("account"); return { start: async () => calls.push("request") }; } });
  vm.runInContext(between("function restoreCloudAccount()") + "restoreCloudAccount();", context);
  await context.cloudAccountStarted;
  assert.deepEqual(calls, []);
  assert.equal(context.cloudAccountRestoring, false);
  assert.equal((main.match(/\brestoreCloudAccount\(\);/g) ?? []).length, 1);
});

test("Origin's legacy Cloud link opens existing server settings without account restore or checkout", async () => {
  const calls = [];
  const win = { isDestroyed: () => false, webContents: { isLoadingMainFrame: () => false, send: (...args) => calls.push(args) } };
  const context = vm.createContext({ app: { isPackaged: true }, desktopRemoteAccess: false, serverReady: true,
    cloudAccountAvailable: () => false, openOriginServerSettings: () => { calls.push("servers"); return true; },
    cloudAccountRestored: async () => calls.push("restore"), activeRemote: () => null, mainWindow: win, createWindow: () => win,
    desktopTray: { show: () => true }, senderIsLocal: () => true, cloudAccount: null, environmentsState: { environments: [], activeId: "local" } });
  vm.runInContext(between("async function openCloudEntry()"), context);
  assert.equal(await vm.runInContext("openCloudEntry()", context), true);
  assert.deepEqual(calls, ["servers"]);
});

test("server startup and account changes have no upstream paid-plan relay", () => {
  assert.doesNotMatch(main, /createProPlanRelay|proPlanRelay|syncProPlan/);
  assert.match(main, /function syncManagedComposioCredentials\(\)/);
  assert.match(main, /desktopCompanionRendererArguments\(rendererOrigin\(\), desktopRemoteAccess\)/);
});
