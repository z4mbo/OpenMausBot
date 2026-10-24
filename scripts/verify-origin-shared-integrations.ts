// Two people on two Origin servers with their own data folders, one in-memory
// Origin backend and a loopback GitHub: the workspace owner connected GitHub
// and an OpenAI key on their computer once; an invited member, whose computer
// holds neither, creates a project's repository, mirrors an issue, reads the
// repository, gets git access for their agents, uses the shared key and links
// their own GitHub. Nothing reaches GitHub or a real Origin deployment.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { launchVerificationServer, type VerificationServer } from "./control-omb.ts";
import { startFakeConvex, type FakeConvex } from "./testing/origin-convex-backend.ts";
import { createFakeGitHub, type FakeGitHub } from "./testing/fake-github.ts";
import { createGitHubStore } from "../server/github/store.ts";

type Json = Record<string, unknown>;
const checks: { check: string; ok: boolean; detail?: unknown }[] = [];
const expect = (check: string, ok: boolean, detail?: unknown) => {
  checks.push({ check, ok, ...(detail === undefined ? {} : { detail }) });
  if (!ok) throw new Error(`${check}: ${JSON.stringify(detail)}`);
};

async function serveGitHub(fake: FakeGitHub) {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const reply = await fake.handle(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, ...(body && req.method !== "GET" ? { body } : {}) }));
    res.writeHead(reply.status, { "content-type": "application/json" });
    res.end(Buffer.from(await reply.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function seed(convex: FakeConvex) {
  const { t, ref } = convex;
  const { createSession } = await convex.load<{ createSession(ctx: unknown, userId: string): Promise<string> }>("convex/lib/auth.ts");
  const user = (email: string) => t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: email.split("@")[0], email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return { userId, token: await createSession(ctx, userId) };
  });
  const owner = await user("ada@fixture.test");
  const member = await user("mia@fixture.test");
  const { teamId } = await t.mutation(ref("workspaces:create"), { sessionToken: owner.token, name: "Acme" }) as { teamId: string };
  const invite = await t.mutation(ref("workspaces:createInvite"), { sessionToken: owner.token, teamId, role: "member" }) as { token: string };
  await t.mutation(ref("workspaces:acceptInvite"), { sessionToken: member.token, token: invite.token });
  return { owner, member, teamId };
}

function client(server: VerificationServer, session: string) {
  return async <T = Json>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: T }> => {
    const response = await fetch(`${server.info.url}${path}`, {
      method: init.method ?? "GET",
      headers: { origin: server.info.url, "content-type": "application/json", "x-origin-session": session },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) as T };
  };
}

async function waitFor(check: () => boolean, ms = 10_000): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((resolve) => setTimeout(resolve, 100))) if (check()) return true;
  return check();
}

function credentialFill(dataDir: string, path: string): Promise<string> {
  const helper = join(dataDir, "origin-git", "credential-helper.cjs").replace(/\\/g, "/");
  const command = `!ELECTRON_RUN_AS_NODE=1 "${process.execPath.replace(/\\/g, "/")}" "${helper}"`;
  return new Promise((resolve) => {
    const child = spawn("git", ["-c", "credential.helper=", "-c", `credential.https://github.com.helper=${command}`, "-c", "credential.https://github.com.useHttpPath=true", "credential", "fill"], { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    let out = "";
    child.stdout.on("data", (chunk) => { out += String(chunk); });
    child.on("close", () => resolve(out));
    child.stdin.end(`protocol=https\nhost=github.com\npath=${path}\n\n`);
  });
}

const fake = await createFakeGitHub();
const github = await serveGitHub(fake);
process.env.ORIGIN_SEALING_KEY = randomBytes(32).toString("base64");
process.env.ORIGIN_GITHUB_API_URL = github.origin;
process.env.OMB_GITHUB_API_URL = github.origin;
const convex = await startFakeConvex();
const servers: VerificationServer[] = [];
let failed = false;
try {
  const people = await seed(convex);
  const ownerGitHub = fake.user("octo", 7);
  fake.install("octo", 7);
  const [ownerServer, memberServer] = [await launchVerificationServer(), await launchVerificationServer()];
  servers.push(ownerServer, memberServer);
  const cloudFile = (server: VerificationServer, token: string, projects: Record<string, string> = {}) =>
    writeFileSync(join(server.info.dataDir, "origin-cloud.json"), JSON.stringify({ url: convex.url, sessionToken: token, projects }), { mode: 0o600 });
  cloudFile(ownerServer, people.owner.token);
  cloudFile(memberServer, people.member.token);
  writeFileSync(join(ownerServer.info.dataDir, "integration-keys.json"), JSON.stringify({ openai: { apiKey: "fixture-openai-secret" } }), { mode: 0o600 });
  const store = createGitHubStore(join(ownerServer.info.dataDir, "origin-github"));
  store.saveApp({ clientId: "Iv1.fixture", clientSecret: "fixture-client-secret", slug: fake.slug, webhookSecret: "fixture-hook", appId: fake.appId, privateKey: fake.privateKeyPem });
  store.saveWorkspace(people.teamId, "octo", 7, people.owner.userId, { access_token: ownerGitHub });
  store.close();

  const owner = client(ownerServer, people.owner.token);
  const member = client(memberServer, people.member.token);
  const teamQuery = `teamId=${encodeURIComponent(people.teamId)}`;

  const before = await member(`/api/github/workspace?${teamQuery}`);
  expect("before sharing, the member's computer reports GitHub as not set up", before.status === 200 && before.body.configured === false && before.body.shared === null, before.body);

  const shared = await owner(`/api/github/workspace?${teamQuery}`);
  expect("the owner's computer shares its GitHub connection with the workspace", (shared.body.shared as Json | null)?.accountLogin === "octo", shared.body);

  const seen = await member(`/api/github/workspace?${teamQuery}`);
  expect("the member sees the workspace's GitHub and who shared it", (seen.body.shared as Json | null)?.sharedByName === "ada" && seen.body.configured === true, seen.body);

  const projectId = String(await convex.t.mutation(convex.ref("projects:create"), { sessionToken: people.member.token, teamId: people.teamId, name: "Mia Launch", githubRepo: "later", githubRepoVisibility: "public" }));
  const created = await member<{ state: string; repoUrl?: string; error?: string }>(`/api/github/repo?${teamQuery}&projectId=${projectId}`, { method: "POST", body: { name: "mia-launch", visibility: "public" } });
  expect("the member creates the project's repository in the workspace's GitHub", created.status === 200 && created.body.repoUrl === "https://github.com/octo/mia-launch", created.body);
  expect("the repository is public, as chosen at creation", fake.repos.get("octo/mia-launch")?.private === false);
  const rule = fake.repos.get("octo/mia-launch")?.protection.get("main") as { required_pull_request_reviews?: { required_approving_review_count?: number }; allow_force_pushes?: boolean; allow_deletions?: boolean } | undefined;
  expect("Origin protects the new repository's default branch: one approving review, no force-push or deletion",
    rule?.required_pull_request_reviews?.required_approving_review_count === 1 && rule.allow_force_pushes === false && rule.allow_deletions === false, rule);

  const board = await convex.t.query(convex.ref("tasks:board"), { sessionToken: people.member.token, projectId }) as { columns: { _id: string; isDraft?: boolean }[] };
  const columnId = board.columns.find((column) => !column.isDraft)!._id;
  const taskId = String(await convex.t.mutation(convex.ref("tasks:createTask"), { sessionToken: people.member.token, projectId, columnId, title: "Landing page", priority: "medium", assignedToEmail: "mia@fixture.test", dueDate: "2030-01-01" }));
  const mirrored = await member<{ results: { taskId: string; issueNumber?: number; error?: string }[] }>("/api/github/mirror", { method: "POST", body: { projectId, taskIds: [taskId] } });
  expect("the member's issue becomes a GitHub issue", mirrored.body.results?.[0]?.issueNumber === 1, mirrored.body);
  const task = await convex.t.run(async (ctx) => (ctx as unknown as { db: { get(id: string): Promise<Json | null> } }).db.get(taskId));
  expect("the backend linked the issue after reading it back from GitHub", task?.githubIssueNumber === 1 && task.githubIssueState === "open", task);

  const snapshot = await member<{ repo: string; tokenConfigured: boolean; issues: { title: string }[] }>(`/api/github/repo?projectId=${projectId}`);
  expect("the member reads the repository through a brokered token", snapshot.body.tokenConfigured && snapshot.body.issues.some((issue) => issue.title === "Landing page"), snapshot.body);

  const bots = await (await fetch(`${memberServer.info.url}/api/bots`, { headers: { origin: memberServer.info.url } })).json() as { bots: { id: string }[] };
  cloudFile(memberServer, people.member.token, { [bots.bots[0]!.id]: projectId });
  const filled = await credentialFill(memberServer.info.dataDir, "octo/mia-launch.git");
  const password = /password=(\S+)/.exec(filled)?.[1] ?? "";
  expect("git in the member's project folder gets a token from Origin", password.startsWith("ghs_"), filled.replace(password, "<token>"));
  expect("that token can only write contents of that one repository", JSON.stringify(fake.tokenScope(password)) === JSON.stringify({ repositories: ["mia-launch"], permissions: { contents: "write" } }), fake.tokenScope(password));
  const direct = await fake.handle(new Request("https://api.github.com/repos/octo/mia-launch/contents/skip.md", { method: "PUT", headers: { authorization: `Bearer ${password}` }, body: JSON.stringify({ branch: "main", message: "skip review", content: "" }) }));
  expect("that token cannot change the default branch without a reviewed pull request", direct.status === 409, direct.status);
  const other = await credentialFill(memberServer.info.dataDir, "octo/secret-plans.git");
  expect("git gets nothing for a repository no linked project uses", !other.includes("password="), other);

  const sharedKey = await owner(`/api/integrations/openai/share?${teamQuery}`, { method: "POST" });
  expect("the owner shares their OpenAI key with the workspace", sharedKey.status === 200, sharedKey.body);
  const keys = await member<{ integrations: { id: string; source: string | null; shared: { by: string } | null }[] }>("/api/integrations");
  const openai = keys.body.integrations.find((entry) => entry.id === "openai");
  expect("the member's computer uses the shared key and says who shared it", openai?.source === "shared" && openai.shared?.by === "ada", openai);
  expect("the shared key's value never reaches the member's client", !JSON.stringify(keys.body).includes("fixture-openai-secret"));

  const vaultItem = (title: string) => convex.t.mutation(convex.ref("credentials:create"), { sessionToken: people.member.token, projectId, kind: "api_key", title, ciphertext: "c", iv: "i", salt: "s", iterations: 1, kdf: "PBKDF2" });
  const [agentItem, privateItem] = [String(await vaultItem("Stripe test")), String(await vaultItem("Bank login"))];
  await convex.t.mutation(convex.ref("credentials:setAgentUse"), { sessionToken: people.member.token, projectId, credentialId: agentItem, agentUse: true });
  const handed = await member("/api/origin/vault/agent-secrets", { method: "PUT", body: { projectId, credentialId: agentItem, value: "sk_test_fixture_value" } });
  const refused = await member("/api/origin/vault/agent-secrets", { method: "PUT", body: { projectId, credentialId: privateItem, value: "not-for-agents" } });
  expect("the member hands agents only the vault item marked for them", handed.status === 200 && refused.status === 409, { handed: handed.status, refused: refused.status });

  const started = await convex.t.action(convex.ref("githubLinks:startLink"), { sessionToken: people.member.token, teamId: people.teamId }) as { userCode: string };
  fake.approveDevice(started.userCode, "mia-dev", 31);
  const linked = await convex.t.action(convex.ref("githubLinks:finishLink"), { sessionToken: people.member.token, teamId: people.teamId }) as Json;
  expect("the member links their own GitHub and is invited to push", linked.login === "mia-dev" && fake.repos.get("octo/mia-launch")?.collaborators.get("mia-dev") === "push", linked);

  const createTask = async (title: string, sessionToken: string, email: string) => String(await convex.t.mutation(convex.ref("tasks:createTask"), { sessionToken, projectId, columnId, title, priority: "medium", assignedToEmail: email, dueDate: "2030-01-01" }));
  const doneColumn = (board.columns as { _id: string; isDone?: boolean }[]).find((column) => column.isDone);
  await convex.t.mutation(convex.ref("taskPRs:configure"), { sessionToken: people.member.token, projectId, mode: "pull_request", reviewColumnId: null, ...(doneColumn ? { doneColumnId: doneColumn._id } : {}) });
  const memberTask = await createTask("Hero section", people.member.token, "mia@fixture.test");
  const opened = await member<{ number?: number; error?: string }>("/api/github/pull-requests", { method: "POST", body: { projectId, taskId: memberTask } });
  const memberPull = fake.repos.get("octo/mia-launch")?.pulls.find((pull) => pull.number === opened.body.number);
  expect("the member's draft pull request opens under their own GitHub account", opened.status === 200 && memberPull?.author === "mia-dev" && memberPull.draft, { opened: opened.body, author: memberPull?.author });
  const memberPlan = fake.commits.find((commit) => commit.repo === "octo/mia-launch" && commit.branch === memberPull?.head.ref);
  expect("its plan commit names the member as co-author with their GitHub address", Boolean(memberPlan?.message.includes("Co-authored-by: mia <31+mia-dev@users.noreply.github.com>")), memberPlan);
  const review = (number: number, action: "approve" | "merge") => owner<{ approved?: boolean; merged?: boolean; error?: string }>("/api/github/pull-requests/review", { method: "POST", body: { projectId, number, action } });
  const approved = await review(memberPull!.number, "approve");
  expect("the Chief's App approval counts on the member's pull request", approved.status === 200 && approved.body.approved === true, approved.body);
  const merged = await review(memberPull!.number, "merge");
  expect("the person-confirmed merge goes through the protected default branch", merged.status === 200 && merged.body.merged === true && memberPull?.merged === true, merged.body);

  const ownerTask = await createTask("Footer links", people.owner.token, "ada@fixture.test");
  const botOpened = await owner<{ number?: number; error?: string }>("/api/github/pull-requests", { method: "POST", body: { projectId, taskId: ownerTask } });
  const botPull = fake.repos.get("octo/mia-launch")?.pulls.find((pull) => pull.number === botOpened.body.number);
  expect("without a linked GitHub the App opens the pull request", botOpened.status === 200 && botPull?.author === `${fake.slug}[bot]`, { opened: botOpened.body, author: botPull?.author });
  const botPlan = fake.commits.find((commit) => commit.repo === "octo/mia-launch" && commit.branch === botPull?.head.ref);
  expect("and credits the person in a Co-authored-by trailer", Boolean(botPlan?.message.includes("Co-authored-by: ada <ada@fixture.test>") && botPull?.body.includes("Co-authored-by: ada <ada@fixture.test>")), botPlan);
  const selfApproval = await review(botPull!.number, "approve");
  const blocked = await review(botPull!.number, "merge");
  expect("the App cannot approve its own pull request past branch protection, and says so", selfApproval.body.approved === false && blocked.status === 400 && Boolean(blocked.body.error?.includes("needs an approving review")) && botPull?.merged === false, { approve: selfApproval.body, merge: blocked.body });

  fake.addRepository("octo", "legacy-site", { private: false });
  const legacyId = String(await convex.t.mutation(convex.ref("projects:create"), { sessionToken: people.owner.token, teamId: people.teamId, name: "Legacy Site", repoUrl: "https://github.com/octo/legacy-site" }));
  const legacyBefore = await convex.t.query(convex.ref("githubProtection:status"), { sessionToken: people.owner.token, projectId: legacyId });
  const legacyAfter = await convex.t.action(convex.ref("githubProtection:protect"), { sessionToken: people.owner.token, projectId: legacyId }) as Json;
  expect("a repository linked before is offered protection, which a project admin applies", legacyBefore === null && legacyAfter.state === "on" && fake.repos.get("octo/legacy-site")?.protection.has("main") === true, { legacyBefore, legacyAfter });

  const memberRow = await convex.t.run(async (ctx) => (ctx as unknown as { db: { query(table: string): { collect(): Promise<Json[]> } } }).db.query("teamMembers").collect())
    .then((rows) => rows.find((row) => row.email === "mia@fixture.test")!);
  await convex.t.mutation(convex.ref("teams:updateRole"), { sessionToken: people.owner.token, teamId: people.teamId, memberId: memberRow._id, role: "viewer" });
  const revoked = await waitFor(() => !fake.repos.get("octo/mia-launch")?.collaborators.has("mia-dev"));
  expect("making the member a viewer takes back the push access Origin gave their GitHub", revoked, [...(fake.repos.get("octo/mia-launch")?.collaborators.keys() ?? [])]);

  const orgInstallation = fake.install("acme-co", 99, "Organization");
  await convex.t.action(convex.ref("teamGitHub:chooseAccount"), { sessionToken: people.owner.token, teamId: people.teamId, installationId: orgInstallation });
  const reshared = await owner(`/api/github/share?${teamQuery}`, { method: "POST" });
  expect("reconnecting GitHub keeps the organization the workspace works in", reshared.status === 200 && (reshared.body.shared as Json | null)?.accountLogin === "acme-co", reshared.body);

  const tokens = fake.calls.filter((call) => call.path.includes("/access_tokens")).length;
  expect("every token came from the backend, minted per repository", tokens > 0);
  console.log(JSON.stringify({ ok: true, owner: ownerServer.info, member: memberServer.info, convex: convex.url, github: github.origin, checks }, null, 2));
} catch (error) {
  failed = true;
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), checks }, null, 2));
} finally {
  for (const server of servers) await server.close();
  await convex.close();
  await github.close();
}
process.exit(failed ? 1 : 0);
