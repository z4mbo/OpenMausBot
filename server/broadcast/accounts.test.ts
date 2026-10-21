import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as atomic from "../atomic.ts";
import * as integrations from "../integration-keys.ts";
import { createBroadcastAccounts, type SocialIntegration } from "./accounts.ts";

const folders: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function setup() {
  const folder = mkdtempSync(join(tmpdir(), "omb-broadcast-accounts-"));
  folders.push(folder);
  const file = join(folder, "broadcast-accounts.json");
  const defaultFile = join(folder, "integration-keys.json");
  const keys = <I extends SocialIntegration>(id: I) => integrations.integrationKey(id, defaultFile);
  return { file, defaultFile, store: createBroadcastAccounts(file, keys), keys };
}

const xFields = { apiKey: "k", apiSecret: "secret", accessToken: "token", accessSecret: "access-secret" };

describe("broadcast accounts", () => {
  it("lists connected defaults with labels and channel mappings, without any values", () => {
    const { store, defaultFile } = setup();
    expect(store.list()).toEqual([]);
    integrations.saveIntegrationKeys("x", xFields, defaultFile);
    integrations.saveIntegrationKeys("bluesky", { handle: "@me.test", appPassword: "secret-password" }, defaultFile);
    integrations.saveIntegrationKeys("linkedin", { authorUrn: "urn:li:person:person123", accessToken: "token" }, defaultFile);
    integrations.saveIntegrationKeys("meta", { pageAccessToken: "page-secret", facebookPageId: "page123" }, defaultFile);
    integrations.saveIntegrationKeys("tiktok", { accessToken: "tiktok-secret" }, defaultFile);
    expect(store.list()).toEqual([
      { id: "default", integration: "x", channels: ["x"], label: "Main account", isDefault: true, projectIds: null, source: "yours" },
      { id: "default", integration: "bluesky", channels: ["bluesky"], label: "@me.test", isDefault: true, projectIds: null, source: "yours" },
      { id: "default", integration: "linkedin", channels: ["linkedin"], label: "person123", isDefault: true, projectIds: null, source: "yours" },
      { id: "default", integration: "meta", channels: ["facebook", "instagram"], label: "Page page123", isDefault: true, projectIds: null, source: "yours" },
      { id: "default", integration: "tiktok", channels: ["tiktok"], label: "Main account", isDefault: true, projectIds: null, source: "yours" },
    ]);
    expect(store.keys("x")).toEqual(xFields);
    expect(store.keys("x", "default")).toEqual(xFields);
    integrations.saveIntegrationKeys("meta", { facebookPageId: "" }, defaultFile);
    expect(store.list().find((account) => account.integration === "meta")?.label).toBe("Main account");
  });

  it("marks a shared default using integration status and passes its project scope", () => {
    const { file } = setup();
    const status = integrations.integrationStatuses().find((item) => item.id === "tiktok")!;
    const keys = vi.spyOn(integrations, "integrationKey").mockImplementation(<I extends integrations.IntegrationId>(id: I) =>
      (id === "tiktok" ? { accessToken: "shared-secret" } : null) as integrations.IntegrationValues<I> | null);
    const statuses = vi.spyOn(integrations, "integrationStatuses").mockReturnValue([{ ...status, source: "shared", configured: true }]);
    expect(createBroadcastAccounts(file).list("p1")).toEqual([
      { id: "default", integration: "tiktok", channels: ["tiktok"], label: "Main account", isDefault: true, projectIds: null, source: "shared" },
    ]);
    expect(keys).toHaveBeenCalledWith("tiktok", undefined, "p1");
    expect(statuses).toHaveBeenCalledWith(undefined, { projectId: "p1" });
  });

  it("persists extra accounts atomically, keeps secrets server-side and enforces project scope", () => {
    const { store, file, keys } = setup();
    const write = vi.spyOn(atomic, "writeFileAtomic");
    const saved = store.add({ integration: "bluesky", label: "  Brand  ", projectIds: ["p1"], fields: { handle: "brand.test", appPassword: "brand-secret" } });
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.account).toEqual({ id: expect.any(String), integration: "bluesky", channels: ["bluesky"], label: "Brand", isDefault: false, projectIds: ["p1"], source: "yours" });
    expect(write).toHaveBeenCalledWith(file, expect.any(String), { mode: 0o600 });
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ accounts: [{
      id: saved.account.id, integration: "bluesky", label: "Brand", projectIds: ["p1"], values: { handle: "brand.test", appPassword: "brand-secret" }, createdAt: expect.any(Number),
    }] });
    const reloaded = createBroadcastAccounts(file, keys);
    expect(reloaded.list()).toEqual([saved.account]);
    expect(reloaded.list("p1")).toEqual([saved.account]);
    expect(reloaded.list("p2")).toEqual([]);
    expect(reloaded.keys("bluesky", saved.account.id, "p1")).toEqual({ handle: "brand.test", appPassword: "brand-secret" });
    expect(reloaded.keys("bluesky", saved.account.id, "p2")).toBeNull();
    expect(reloaded.keys("x", saved.account.id)).toBeNull();
    expect(reloaded.keys("bluesky", "unknown")).toBeNull();
    expect(JSON.stringify(reloaded.list())).not.toContain("values");
    expect(JSON.stringify(reloaded.list())).not.toContain("brand-secret");
    expect(reloaded.remove("default")).toBe(false);
    expect(reloaded.remove(saved.account.id)).toBe(true);
    expect(reloaded.remove(saved.account.id)).toBe(false);
    expect(reloaded.keys("bluesky", saved.account.id)).toBeNull();
    expect(reloaded.list()).toEqual([]);
  });

  it("keeps unrestricted accounts visible and accepts optional Meta fields", () => {
    const { store } = setup();
    expect(store.add({ integration: "meta", label: "Meta", fields: { pageAccessToken: "  secret  ", instagramUserId: "" } })).toMatchObject({ ok: true });
    const [account] = store.list("p2");
    expect(account.channels).toEqual(["facebook", "instagram"]);
    expect(store.keys("meta", account.id, "p2")).toEqual({ pageAccessToken: "secret" });
  });

  it.each([
    { integration: "fal" }, { label: " " }, { label: "a".repeat(61) }, { label: "a\nb" },
    { fields: null }, { fields: [] }, { fields: { ...xFields, unknown: "bad" } },
    { fields: { ...xFields, apiKey: 42 } }, { fields: { ...xFields, apiKey: " " } },
    ...["\0", "\r", "\n", "a".repeat(4097)].map((apiKey) => ({ fields: { ...xFields, apiKey } })),
    { projectIds: "p1" }, { projectIds: [1] }, { projectIds: [""] },
  ])("rejects invalid account input %# without persisting it", (change) => {
    const { store } = setup();
    const input = { integration: "x", label: "Brand", fields: xFields, ...change };
    expect(store.add(input as Parameters<typeof store.add>[0])).toMatchObject({ ok: false, error: expect.any(String) });
    expect(store.list()).toEqual([]);
  });

  it("caps each integration separately and frees a slot on removal", () => {
    const { store } = setup();
    for (let i = 0; i < 10; i += 1) expect(store.add({ integration: "x", label: `Account ${i}`, fields: xFields }).ok).toBe(true);
    expect(store.add({ integration: "x", label: "Eleventh", fields: xFields })).toMatchObject({ ok: false });
    expect(store.add({ integration: "tiktok", label: "Video", fields: { accessToken: "t" } }).ok).toBe(true);
    store.remove(store.list()[0].id);
    expect(store.add({ integration: "x", label: "Replacement", fields: xFields }).ok).toBe(true);
  });

  it("ignores malformed stored accounts", () => {
    const { file, store } = setup();
    writeFileSync(file, JSON.stringify({ accounts: [null, { id: "bad", integration: "x" }] }));
    expect(store.list()).toEqual([]);
    writeFileSync(file, "invalid json");
    expect(store.keys("x", "bad")).toBeNull();
  });
});
