// Who runs a shared agent, end to end in a disposable workspace: the real Convex functions in memory, an isolated
// fake-engine server, and the real chat header and Who runs card in headless Chromium, seen by the owner and a member.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchVerificationServer, runControlOmb } from "./control-omb.ts";
import { mountPreview, REPO_ROOT } from "./testing/preview-fixture.ts";
import { startFakeConvex, type FakeConvex } from "./testing/origin-campaigns-backend.ts";

type Json = Record<string, unknown>;

const EVIDENCE = join(REPO_ROOT, "docs", "verification", "evidence", "origin-runs-on");

async function seed(convex: FakeConvex) {
  const { t, ref } = convex;
  const { createSession } = await convex.load<{ createSession(ctx: unknown, userId: string): Promise<string> }>("convex/lib/auth.ts");
  const person = (name: string) => t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name, email: `${name.toLowerCase()}@fixture.test`, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return { userId, token: await createSession(ctx, userId) };
  });
  const ada = await person("Ada");
  const grace = await person("Grace");
  const as = (who: { token: string }, name: string, args: Json) => t.mutation(ref(name), { sessionToken: who.token, ...args });
  const { teamId } = await as(ada, "workspaces:create", { name: "Fixture" }) as { teamId: string };
  await t.run((ctx) => ctx.db.insert("teamMembers", { teamId, userId: grace.userId, email: "grace@fixture.test", name: "Grace", role: "member", status: "active", createdAt: 1, updatedAt: 1 }));
  const projectId = String(await as(ada, "projects:create", { teamId, name: "Launch" }));
  await as(ada, "members:addWorkspaceMember", { projectId, email: "grace@fixture.test", role: "member" });
  await as(ada, "agents:setSharedAgents", { teamId, enabled: true });
  const [{ agentId }] = await as(ada, "agents:publishProjectTeam", { teamId, projectId, agents: [{ roleKey: "planner", kind: "agent", name: "Planner" }] }) as { agentId: string }[];
  const host = (who: { token: string }, name: string, kind: "local" | "server", provider: string, plan: string) =>
    as(who, "agents:publishHost", { teamId, name, engines: ["claude"], models: ["claude-opus"], computers: [], kind, plans: [{ agentId, provider, plan }] }) as Promise<string>;
  const laptop = await host(ada, "Ada's MacBook", "local", "claude", "max");
  const server = await host(ada, "origin-vps", "server", "key", "Anthropic");
  await host(grace, "Grace's ThinkPad", "local", "chatgpt", "plus");
  return { ada, grace, teamId, agentId, laptop, server };
}

const convex = await startFakeConvex();
const seeded = await seed(convex);
const live = await launchVerificationServer();
const report: Json = { screenshots: [] as string[], checks: {} as Record<string, boolean>, observed: {} as Record<string, unknown> };
const checks = report.checks as Record<string, boolean>;
const observed = report.observed as Record<string, unknown>;
const shots = report.screenshots as string[];
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
let browser: { close(): Promise<void> } | undefined;
try {
  await runControlOmb(["new-bot", "--name", "Planner", "--url", live.info.url]);
  const cloud = fileURLToPath(new URL("./testing/origin-runs-on-cloud.ts", import.meta.url));
  preview = await mountPreview(live, {
    entry: "/scripts/testing/origin-runs-on-preview.tsx", route: "/__origin-runs-on.html", title: "Isolated runs-on", logLevel: "warn",
    extraRoutes: [{ path: "/__origin-campaigns.json", handler: (_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ url: convex.url, token: seeded.ada.token, viewerToken: seeded.grace.token, agentId: seeded.agentId, teamId: seeded.teamId }));
    } }],
    aliases: [
      { find: /^@\/lib\/origin-cloud(?:\/client)?$/, replacement: cloud },
      { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
    ],
  });

  const playwright = await import(process.env.OMB_VERIFY_PLAYWRIGHT ? pathToFileURL(process.env.OMB_VERIFY_PLAYWRIGHT).href : "playwright") as typeof import("playwright");
  const chromium = await playwright.chromium.launch();
  browser = chromium;
  const errors: string[] = [];
  const open = async (as: "ada" | "grace", width = 1440) => {
    const context = await chromium.newContext({ viewport: { width, height: 1320 }, colorScheme: "dark" });
    await context.addInitScript(() => { try { localStorage.setItem("omb-skin", "midnight"); } catch { /* storage blocked */ } });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${preview!.previewUrl}${as === "grace" ? "?viewer" : ""}`);
    await page.locator('[data-testid="access-runs-on"]').waitFor({ timeout: 60_000 });
    await page.locator('[data-testid="runs-on-badge"]').waitFor({ timeout: 30_000 });
    return page;
  };
  const badge = async (page: Awaited<ReturnType<typeof open>>) => ({
    kind: await page.locator('[data-testid="runs-on-badge"]').getAttribute("data-runs-on-kind"),
    text: (await page.locator('[data-testid="runs-on-badge"]').innerText()).trim(),
    label: await page.locator('[data-testid="runs-on-badge"]').getAttribute("aria-label"),
    offline: await page.locator('[data-testid="runs-on-offline"]').count() > 0,
  });
  const header = (page: Awaited<ReturnType<typeof open>>) => page.locator('[data-testid="runs-on-chat"] [data-glass-bar="top"]').first();
  const shoot = async (target: { screenshot(options: { path: string }): Promise<unknown> }, name: string) => {
    mkdirSync(EVIDENCE, { recursive: true });
    await target.screenshot({ path: join(EVIDENCE, `${name}.png`) });
    shots.push(`docs/verification/evidence/origin-runs-on/${name}.png`);
  };
  const settle = (page: Awaited<ReturnType<typeof open>>) => page.waitForTimeout(2_000);

  const ada = await open("ada");
  await ada.waitForFunction(() => document.querySelector('[data-testid="runs-on-badge"]')?.textContent?.includes("You"));
  observed.adaSender = await badge(ada);
  checks.senderModeShowsYou = (observed.adaSender as { text: string }).text.endsWith("You · Claude");
  await shoot(ada.locator('[data-testid="access-runs-on"]'), "picker-whoever-writes");
  await ada.getByRole("radio", { name: /A chosen member/ }).click();
  await shoot(ada.locator('[data-testid="access-runs-on"]'), "picker-chosen-member");
  checks.memberListShowsPlan = await ada.locator('[data-testid="access-runs-on"]').getByText("Claude Max").count() > 0;
  await ada.getByRole("radio", { name: /You · Ada's MacBook/ }).click();
  await settle(ada);
  checks.ownerChoiceSaved = await ada.getByRole("radio", { name: /You · Ada's MacBook/ }).getAttribute("aria-checked") === "true";

  const grace = await open("grace");
  await grace.waitForFunction(() => document.querySelector('[data-testid="runs-on-badge"]')?.textContent?.includes("Ada"));
  observed.graceMember = await badge(grace);
  checks.memberBadgeNamesRunnerAndPlan = (observed.graceMember as { text: string }).text.endsWith("Ada · Claude Max");
  await shoot(header(grace), "badge-chosen-member");
  checks.memberCannotEdit = await grace.getByRole("radio", { name: /Whoever writes/ }).isDisabled();
  checks.memberCanOfferOwnComputer = await grace.getByRole("switch", { name: /Offer Grace's ThinkPad to run agents/ }).isEnabled();
  await shoot(grace.locator('[data-testid="access-runs-on"]'), "picker-member-view");

  await convex.t.run((ctx) => ctx.db.patch(seeded.laptop, { heartbeatAt: Date.now() - 10 * 60_000 }));
  await grace.reload();
  await grace.waitForFunction(() => document.querySelector('[data-testid="runs-on-offline"]') !== null, undefined, { timeout: 30_000 });
  observed.graceOffline = await badge(grace);
  checks.offlineIsShown = (observed.graceOffline as { offline: boolean; label: string }).offline && /offline/.test((observed.graceOffline as { label: string }).label);
  await shoot(header(grace), "badge-chosen-member-offline");
  await shoot(grace.locator('[data-testid="access-runs-on"]'), "picker-offline-note");

  await ada.getByRole("radio", { name: /^Cloud/ }).click();
  await ada.getByRole("radio", { name: /Your server · origin-vps/ }).click();
  await settle(ada);
  await shoot(ada.locator('[data-testid="access-runs-on"]'), "picker-cloud");
  await grace.reload();
  await grace.waitForFunction(() => document.querySelector('[data-testid="runs-on-badge"]')?.getAttribute("data-runs-on-kind") === "cloud", undefined, { timeout: 30_000 });
  observed.graceCloud = await badge(grace);
  checks.cloudBadge = (observed.graceCloud as { text: string }).text === "Cloud" && /Anthropic key/.test((observed.graceCloud as { label: string }).label);
  await shoot(header(grace), "badge-cloud");

  await ada.getByRole("radio", { name: /Whoever writes/ }).click();
  await settle(ada);
  await grace.reload();
  await grace.waitForFunction(() => document.querySelector('[data-testid="runs-on-badge"]')?.textContent?.includes("You"), undefined, { timeout: 30_000 });
  observed.graceSender = await badge(grace);
  checks.senderBadgeForMember = (observed.graceSender as { text: string }).text.endsWith("You · Claude");
  await shoot(header(grace), "badge-whoever-writes");

  const narrow = await open("grace", 900);
  observed.narrowTextHidden = await narrow.locator('[data-testid="runs-on-badge"] > span:last-child').isHidden();
  checks.compactAtNarrowWidths = observed.narrowTextHidden === true;
  await shoot(header(narrow), "badge-compact");

  const runsOn = await convex.t.query(convex.ref("agentHosts:runsOn"), { sessionToken: seeded.grace.token, agentId: seeded.agentId });
  observed.finalRunsOn = runsOn;
  checks.backendBackToSender = (runsOn as { mode: string }).mode === "sender";
  report.pageErrors = errors;
  checks.noPageErrors = errors.length === 0;
} catch (error) {
  report.error = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  process.exitCode = 1;
} finally {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, logPath: live.info.logPath }, null, 2));
  if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
  await browser?.close();
  await preview?.close();
  await live.close();
  await convex.close();
}
