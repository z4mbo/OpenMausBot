import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createModelHostState, modelHostAccountKey, modelHostOrigin, type ModelHostAccountState } from "./origin-model-host-state.ts";

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
const fixture = () => { const folder = mkdtempSync(join(tmpdir(), "origin-model-host-state-")); folders.push(folder); return join(folder, "state.json"); };
const account = (): ModelHostAccountState => ({ origin: "https://fixture.convex.cloud", userId: "owner1", teamId: "team1", hostId: "host1", hostToken: "a".repeat(64), sources: {} });

describe("private model host identity", () => {
  it("keeps one device identity across restarts and separates origins, accounts and teams", () => {
    const file = fixture(), state = createModelHostState(file), deviceId = state.deviceId();
    state.put(account());
    const restored = createModelHostState(file);
    expect(restored.deviceId()).toBe(deviceId);
    expect(restored.account(account().origin, "owner1", "team1")).toEqual(account());
    for (const [origin, user, team] of [["https://other.convex.cloud", "owner1", "team1"], [account().origin, "owner2", "team1"], [account().origin, "owner1", "team2"]]) expect(restored.account(origin!, user!, team!)).toBeUndefined();
    expect(modelHostAccountKey(account().origin, "owner1", "team1")).not.toContain("owner1");
  });

  it("returns snapshots which cannot mutate a saved host token or local source mapping", () => {
    const state = createModelHostState(fixture()); state.put(account());
    const returned = state.account(account().origin, "owner1", "team1")!;
    returned.hostToken = "changed-outside-store";
    expect(state.account(account().origin, "owner1", "team1")!.hostToken).toBe(account().hostToken);
  });

  it("fails closed on corrupt or cross-account state instead of registering a second device", () => {
    const file = fixture(); writeFileSync(file, '{"deviceId":"secret-never-echoed"');
    expect(() => createModelHostState(file).deviceId()).toThrow(/cannot be read safely/);
    expect(() => createModelHostState(file).deviceId()).not.toThrow(/secret-never-echoed/);
    expect(readFileSync(file, "utf8")).toContain("secret-never-echoed");
  });

  it("accepts owned local fixtures and rejects credential-bearing or insecure remote origins", () => {
    expect(modelHostOrigin("http://127.0.0.1:4444")).toBe("http://127.0.0.1:4444");
    for (const origin of ["http://example.com", "https://user:password@example.com", "https://example.com/path", "https://example.com/?token=secret"]) expect(() => modelHostOrigin(origin)).toThrow();
  });
});
