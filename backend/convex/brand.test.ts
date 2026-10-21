/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { createSession } from "./lib/auth";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function fixture() {
  const t = convexTest(schema, modules);
  const user = async (email: string) => t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: email.split("@")[0]!, email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return createSession(ctx, userId);
  });
  const owner = await user("owner@brand.test");
  const viewer = await user("viewer@brand.test");
  const outsider = await user("outsider@brand.test");
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken: owner, name: "Brand" });
  const projectId = await t.mutation(api.projects.create, { sessionToken: owner, teamId, name: "Lumen" });
  const invite = await t.mutation(api.workspaces.createInvite, { sessionToken: owner, teamId, role: "member", email: "viewer@brand.test" });
  await t.mutation(api.workspaces.acceptInvite, { sessionToken: viewer, token: invite.token });
  await t.mutation(api.members.addWorkspaceMember, { sessionToken: owner, projectId, email: "viewer@brand.test", role: "viewer" });
  const asset = async (name: string, type: "image" | "document") => {
    await t.mutation(api.design.createAsset, { sessionToken: owner, projectId, type, name, url: `https://cdn.brand.test/${name}` });
    return (await t.query(api.design.list, { sessionToken: owner, projectId })).assets.find((row) => row.name === name)!._id;
  };
  return { t, owner, viewer, outsider, projectId, asset };
}

describe("brand kits", () => {
  test("the first save drafts the kit from the project and later saves change only what they name", async () => {
    const f = await fixture();
    expect(await f.t.query(api.brand.get, { sessionToken: f.owner, projectId: f.projectId })).toBeNull();
    const logo = await f.asset("logo.svg", "image");
    await f.t.mutation(api.brand.update, {
      sessionToken: f.owner, projectId: f.projectId, agentName: "Atlas",
      kit: { tagline: "Light for night owls", colors: { primary: "#7c3aed", neutrals: ["#fff", "#111827"] }, voice: { adjectives: ["warm", "Warm", "precise"] }, logoAssetIds: [logo] },
    });
    await f.t.mutation(api.brand.update, { sessionToken: f.owner, projectId: f.projectId, kit: { fonts: { heading: "fraunces" }, imagery: ["soft light", "film grain"] } });
    const kit = await f.t.query(api.brand.get, { sessionToken: f.viewer, projectId: f.projectId });
    expect(kit).toMatchObject({
      name: "Lumen", tagline: "Light for night owls", voice: { adjectives: ["warm", "precise"], do: [], dont: [] },
      colors: { primary: "#7C3AED", secondary: "#F59E0B", neutrals: ["#FFFFFF", "#111827"] },
      fonts: { heading: "fraunces", body: "inter" }, imagery: ["soft light", "film grain"], updatedBy: "owner",
      logos: [{ assetId: logo, name: "logo.svg", url: "https://cdn.brand.test/logo.svg" }], icon: null,
    });
    expect(kit?.agentName).toBeUndefined();
  });

  test("refuses bad colours, unknown fonts, other projects' assets and non-images, and anyone who cannot edit", async () => {
    const f = await fixture();
    const update = (sessionToken: string, kit: Record<string, unknown>) => f.t.mutation(api.brand.update, { sessionToken, projectId: f.projectId, kit });
    await expect(update(f.owner, { colors: { primary: "blue" } })).rejects.toThrow(/primary colour/);
    await expect(update(f.owner, { fonts: { body: "comic-sans" } })).rejects.toThrow(/body font/);
    await expect(update(f.owner, { name: "  " })).rejects.toThrow(/name/);
    const brief = await f.asset("brief.pdf", "document");
    await expect(update(f.owner, { iconAssetId: brief })).rejects.toThrow(/not an image/);
    await expect(update(f.owner, { logoAssetIds: ["nope"] })).rejects.toThrow(/No asset/);
    await expect(update(f.viewer, { tagline: "x" })).rejects.toThrow(/Edit role/);
    await expect(update(f.outsider, { tagline: "x" })).rejects.toThrow();
    await expect(f.t.query(api.brand.get, { sessionToken: f.outsider, projectId: f.projectId })).rejects.toThrow();
  });
});
