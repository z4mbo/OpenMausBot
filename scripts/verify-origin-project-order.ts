import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { mountPreview, parkUntilSignal, REPO_ROOT } from "./testing/preview-fixture.ts";

const folder = join(REPO_ROOT, ".omb-scratch/project-order-native-042");
const record = JSON.parse(await readFile(join(folder, "fixture.json"), "utf8"));
assert.equal(record.pushExit, 0);
assert.equal(record.source, "working-tree");
const native = new URL(record.url);
assert.equal(native.hostname, "127.0.0.1");
assert.ok(![3210, 3211, 5199, 8799].includes(Number(native.port)));
const instance = await fetch(new URL("/instance_name", native), { signal: AbortSignal.timeout(2000) }).then(response => response.text());
assert.equal(instance.replaceAll('"', "").trim(), record.instance);
const client = new ConvexHttpClient(native.origin);
const query = <T,>(name: string, args: Record<string, unknown>) => client.query(makeFunctionReference<"query">(name), args) as Promise<T>;
const mutation = <T,>(name: string, args: Record<string, unknown>) => client.mutation(makeFunctionReference<"mutation">(name), args) as Promise<T>;
const action = <T,>(name: string, args: Record<string, unknown>) => client.action(makeFunctionReference<"action">(name), args) as Promise<T>;
const seedFile = join(folder, "private/project-order-accounts.json");
let seed: { teamId: string; owner: string; member: string; memberId: string; projects: Array<{ id: string; name: string }> };
try { seed = JSON.parse(await readFile(seedFile, "utf8")); }
catch {
  const suffix = randomBytes(5).toString("hex"), password = `Synthetic-${randomBytes(18).toString("hex")}`;
  const owner = await action<{ sessionToken: string }>("auth:signup", { email: `order-owner-${suffix}@example.test`, password, name: "Order Fixture Owner", workspaceName: "Project order fixture" });
  const [team] = await query<Array<{ _id: string }>>("workspaces:list", { sessionToken: owner.sessionToken });
  assert.ok(team);
  const memberEmail = `order-member-${suffix}@example.test`;
  const invitation = await mutation<{ token: string }>("workspaces:createInvite", { sessionToken: owner.sessionToken, teamId: team._id, email: memberEmail, role: "member" });
  const member = await action<{ sessionToken: string }>("auth:signup", { email: memberEmail, password, name: "Order Fixture Member", inviteToken: invitation.token });
  await mutation("workspaces:acceptInvite", { sessionToken: member.sessionToken, token: invitation.token });
  const projects = [];
  for (const name of ["Alpha", "Private planning", "Bravo", "Charlie"]) {
    const id = await mutation<string>("projects:create", { sessionToken: owner.sessionToken, teamId: team._id, name, githubRepo: "later" });
    projects.push({ id, name });
    if (name !== "Private planning") await mutation("members:addWorkspaceMember", { sessionToken: owner.sessionToken, projectId: id, email: memberEmail, role: "member" });
  }
  const members = await query<Array<{ _id: string; email: string }>>("workspaces:members", { sessionToken: owner.sessionToken, teamId: team._id });
  const person = members.find(row => row.email === memberEmail); assert.ok(person);
  seed = { teamId: team._id, owner: owner.sessionToken, member: member.sessionToken, memberId: person._id, projects };
  await writeFile(seedFile, JSON.stringify(seed), { flag: "wx", mode: 0o600 });
}
const bindings = await Promise.all(["src/components/SidebarProjects.tsx", "src/lib/origin-project-order.ts", "src/lib/origin-workspaces.ts", "src/lib/use-pointer-reorder.ts", "backend/convex/projects.ts"].map(async name => ({ name, sha256: createHash("sha256").update(await readFile(join(REPO_ROOT, name))).digest("hex") })));
const previews: Awaited<ReturnType<typeof mountPreview>>[] = [];
try {
  for (const name of ["owner", "member"] as const) {
    const localProjects = seed.projects.filter(project => name === "owner" || project.name !== "Private planning").map((project, index) => ({ id: `${name}-chief-${index}`, name: project.name, cloudId: project.id }));
    const cache = join(folder, `ui-${name}`); await mkdir(cache, { recursive: true });
    const preview = await mountPreview({ info: { url: native.origin, dataDir: cache } }, {
      entry: "/scripts/testing/origin-project-order-preview.tsx", route: "/__origin-project-order.html", title: `Origin project order · ${name}`, hmr: false,
      extraRoutes: [
        { path: "/__fixture/project-order/bootstrap", method: "GET", handler(_req, res) { res.setHeader("cache-control", "no-store"); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ client: name, url: native.origin, sessionToken: seed[name], teamId: seed.teamId, projects: localProjects })); } },
        { path: "/api/origin/cloud-links", method: "GET", handler(_req, res) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ workspaces: {}, projects: Object.fromEntries(localProjects.map(project => [project.id, project.cloudId])) })); } },
        { path: "/__fixture/project-order/state", method: "GET", async handler(_req, res) {
          const rows = await query<Array<{ _id: string; name: string; order?: number }>>("projects:listForUser", { sessionToken: seed[name], teamId: seed.teamId });
          res.setHeader("cache-control", "no-store"); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ client: name, teamId: seed.teamId, backend: native.origin, bindings, projects: rows.map(row => ({ id: row._id, name: row.name, order: row.order })), scope: "Actual SidebarProjects and Convex session/query/mutation hooks. Separate browser origins, synthetic people and independent local Chief IDs. Rows use a controlled surrounding shell; not full App or native desktop acceptance." }));
        } },
        { path: "/__fixture/project-order/member-role", method: "POST", async handler(req, res) {
          let body = ""; for await (const part of req) { body += String(part); if (body.length > 1024) throw new Error("Oversized fixture control"); }
          const role = JSON.parse(body).role; if (role !== "viewer" && role !== "member") throw new Error("Invalid fixture role");
          await mutation("teams:updateRole", { sessionToken: seed.owner, teamId: seed.teamId, memberId: seed.memberId, role });
          res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ role }));
        } },
      ],
    });
    previews.push(preview);
    console.log(JSON.stringify({ client: name, previewUrl: preview.previewUrl, stateUrl: new URL("/__fixture/project-order/state", preview.previewUrl).href, backend: native.origin, independentLocalChiefs: localProjects.length }));
  }
  await parkUntilSignal();
} finally { for (const preview of previews) await preview.close(); }
