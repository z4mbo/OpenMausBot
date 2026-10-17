import { describe, expect, it, vi } from "vitest";
import type { WorkspaceMember } from "./origin-members";

vi.mock("@/lib/origin-cloud", () => ({ cloudMutation: vi.fn(), cloudQueryOnce: vi.fn() }));

const { accessChanges, currentAccess, grantsFor } = await import("./origin-project-access");
const { exclusiveWithSync } = await import("./origin-sync");

const person = (email: string, role: WorkspaceMember["role"]): WorkspaceMember => ({ _id: email, name: email.split("@")[0]!, email, role, avatarUrl: null });
const members = [person("me@x.io", "admin"), person("boss@x.io", "owner"), person("ann@x.io", "member"), person("bob@x.io", "viewer"), person("cy@x.io", "member")];
const row = (email: string, role: WorkspaceMember["role"] = "member") => ({ _id: `row-${email}`, email, role, status: "active" });

describe("project access", () => {
  it("grants nobody for a private project and every non-admin for everyone, viewers read-only", () => {
    expect(grantsFor({ mode: "private", emails: [] }, members, "me@x.io")).toEqual([]);
    expect(grantsFor({ mode: "everyone", emails: [] }, members, "me@x.io")).toEqual([
      { email: "ann@x.io", role: "member" }, { email: "bob@x.io", role: "viewer" }, { email: "cy@x.io", role: "member" },
    ]);
  });

  it("grants only chosen people, ignoring admins and addresses outside the workspace", () => {
    expect(grantsFor({ mode: "people", emails: ["ANN@x.io", "boss@x.io", "stranger@y.io"] }, members, "me@x.io")).toEqual([{ email: "ann@x.io", role: "member" }]);
  });

  it("adds missing rows and removes extra ones, keeping owner rows and admins' rows", () => {
    const rows = [row("me@x.io", "owner"), row("boss@x.io"), row("bob@x.io"), row("cy@x.io")];
    expect(accessChanges([{ email: "ann@x.io", role: "member" }, { email: "cy@x.io", role: "member" }], rows, members))
      .toEqual({ add: [{ email: "ann@x.io", role: "member" }], remove: ["row-bob@x.io"] });
  });

  it("reads the choice back from the project's rows", () => {
    expect(currentAccess([row("me@x.io", "owner")], members, "me@x.io")).toEqual({ mode: "private", emails: [] });
    expect(currentAccess([row("ann@x.io"), row("bob@x.io"), row("cy@x.io")], members, "me@x.io").mode).toBe("everyone");
    expect(currentAccess([row("bob@x.io")], members, "me@x.io")).toEqual({ mode: "people", emails: ["bob@x.io"] });
  });
});

describe("exclusiveWithSync", () => {
  it("runs work one at a time, even after a failure", async () => {
    const order: string[] = [];
    let release!: () => void;
    const first = exclusiveWithSync(() => new Promise<void>((resolve) => { order.push("first"); release = resolve; }));
    const failing = exclusiveWithSync(async () => { order.push("failing"); throw new Error("boom"); });
    const last = exclusiveWithSync(async () => { order.push("last"); });
    await Promise.resolve();
    expect(order).toEqual(["first"]);
    release();
    await first;
    await expect(failing).rejects.toThrow("boom");
    await last;
    expect(order).toEqual(["first", "failing", "last"]);
  });
});
