// Origin cards in agent chat, end to end in a disposable workspace: the real Convex functions in memory,
// the fake engine calling the real agents tools, and the full renderer in headless Chromium.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { launchVerificationServer, runControlOmb } from "./control-omb.ts";
import { fixtureApi, mountPreview, REPO_ROOT } from "./testing/preview-fixture.ts";
import { startFakeConvex, type FakeConvex } from "./testing/origin-campaigns-backend.ts";

type Json = Record<string, unknown>;

const EVIDENCE = join(REPO_ROOT, "docs", "verification", "evidence", "origin-chat-cards");
const PROMPT = "Show me where the launch stands: the post you drafted, the campaign, our assets, the vault, the repo, user feedback and the last call.";
const swatchSvg = (fill: string, label: string, width = 640, height = 360) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${fill}"/><circle cx="${width * 0.7}" cy="${height * 0.4}" r="${Math.min(width, height) / 4}" fill="white" fill-opacity="0.18"/><text x="24" y="${height - 30}" font-family="sans-serif" font-size="28" fill="white">${label}</text></svg>`;
const swatch = (fill: string, label: string, width?: number, height?: number) => `data:image/svg+xml;utf8,${encodeURIComponent(swatchSvg(fill, label, width, height))}`;

/** A flat colour with a lighter disc, as a PNG data URL: Broadcast publishes PNG but not SVG. */
function pngSwatch(hex: string, width: number, height: number): string {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const lit = (x - width * 0.7) ** 2 + (y - height * 0.4) ** 2 < (Math.min(width, height) / 4) ** 2 ? 40 : 0;
      raw.set([Math.min(255, r! + lit), Math.min(255, g! + lit), Math.min(255, b! + lit)], y * (width * 3 + 1) + 1 + x * 3);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function seed(convex: FakeConvex) {
  const { t, ref } = convex;
  const { createSession } = await convex.load<{ createSession(ctx: unknown, userId: string): Promise<string> }>("convex/lib/auth.ts");
  const token = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "ada", email: "ada@fixture.test", role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return createSession(ctx, userId);
  });
  const as = (name: string, args: Json) => t.mutation(ref(name), { sessionToken: token, ...args });
  const { teamId } = await as("workspaces:create", { name: "Fixture" }) as { teamId: string };
  const projectId = String(await as("projects:create", { teamId, name: "Origin Lite", repoUrl: "https://github.com/acme/origin-lite" }));
  const now = Date.now();
  const insert = (table: string, row: Json) => t.run((ctx) => ctx.db.insert(table as never, row as never));
  const hero = await insert("designAssets", { projectId, type: "image", name: "Launch hero.png", url: pngSwatch("#3b5bdb", 1200, 675), contentType: "image/png", folder: "Brand", createdAt: now, updatedAt: now });
  await insert("designAssets", { projectId, type: "image", name: "App icon", url: swatch("#2b8a3e", "icon", 512, 512), contentType: "image/svg+xml", folder: "Brand", createdAt: now - 1, updatedAt: now - 1 });
  await insert("designAssets", { projectId, type: "image", name: "Pricing table", url: swatch("#a61e4d", "pricing", 800, 800), contentType: "image/svg+xml", createdAt: now - 2, updatedAt: now - 2 });
  await insert("designAssets", { projectId, type: "document", name: "Press kit.pdf", url: "https://cdn.fixture.test/press-kit.pdf", createdAt: now - 3, updatedAt: now - 3 });
  const published = String(await as("broadcast:save", { projectId, variants: [{ channel: "x", text: "Origin Lite beta opens Monday." }], assetIds: [hero] }));
  const campaignId = String(await as("campaigns:create", {
    projectId, name: "Origin Lite launch", goal: "500 beta sign-ups in the first two weeks from founders who run small teams.",
    channels: ["x", "linkedin", "bluesky"], startDate: "2026-10-26", endDate: "2026-11-09", status: "running",
  }));
  await as("campaigns:link", { projectId, campaignId, kind: "post", itemId: published });
  const cipher = { ciphertext: "CIPHERTEXT", iv: "IV", salt: "SALT", iterations: 1, kdf: "pbkdf2", createdAt: now, updatedAt: now };
  await insert("credentials", { projectId, title: "Stripe live key", kind: "api_key", agentUse: true, username: "billing@acme.test", ...cipher });
  await insert("credentials", { projectId, title: "Vercel deploy token", kind: "secret", agentUse: true, ...cipher });
  await insert("credentials", { projectId, title: "App Store login", kind: "password", username: "ada@acme.test", url: "https://appstoreconnect.apple.com", ...cipher });
  await as("feedback:configure", { teamId, projectId, title: "Origin Lite feedback", description: "Tell us what to fix", enabled: true });
  const portal = await t.run((ctx) => ctx.db.query("feedbackPortals").first());
  await insert("feedbackEntries", { portalId: portal!._id, title: "Export to CSV drops the last row", body: "When I export the issues board the final row is missing every time.", kind: "bug", status: "new", createdAt: now - 60_000 });
  await insert("feedbackEntries", { portalId: portal!._id, title: "Dark mode for the public pages", body: "Our customers read the changelog at night. A dark theme would help.", kind: "idea", status: "new", createdAt: now - 120_000 });
  await as("callNotes:record", {
    projectId, callName: "Launch sync", startedAt: now - 3_600_000, minutes: 32,
    keyPoints: ["Beta list is at 312 sign-ups", "Press embargo lifts Monday 09:00"], decisions: ["Ship the pricing page before the post goes out"],
    actionItems: [{ title: "Fix the CSV export row bug", owner: "Ada" }, { title: "Record the 30-second demo reel" }, { title: "Brief two design partners" }],
  });
  await insert("githubPullRequests", { projectId, number: 42, title: "Pricing page with annual plans", state: "open", url: "https://github.com/acme/origin-lite/pull/42", author: "atlas-bot", branch: "pricing-page", createdAt: now, updatedAt: now, syncedAt: now });
  await insert("githubPullRequests", { projectId, number: 41, title: "Fix CSV export last row", state: "open", url: "https://github.com/acme/origin-lite/pull/41", author: "ada", branch: "csv-fix", createdAt: now, updatedAt: now - 1, syncedAt: now });
  await insert("commits", { projectId, sha: "9f3c2a1b7d", message: "Waitlist form posts to the CRM", author: "ada", committedAt: now - 7_200_000, createdAt: now });
  await insert("commits", { projectId, sha: "1a2b3c4d5e", message: "Launch hero on the landing page", author: "atlas-bot", committedAt: now - 9_000_000, createdAt: now });
  await insert("githubBranchProtections", { projectId, repoUrl: "https://github.com/acme/origin-lite", branch: "main", state: "on", checkedAt: now });
  return { token, projectId };
}

const TOOL_CALLS = [
  { name: "origin_broadcast_draft", input: { channels: ["x", "linkedin", "bluesky"], text: "Origin Lite is live. Plan the work, ship it with your agents, launch it the same week. Join the beta: https://origin.example/lite #buildinpublic", media: ["Launch hero.png"] } },
  { name: "origin_campaign_get", input: { campaign: "Origin Lite launch" } },
  { name: "origin_list_assets", input: {} },
  { name: "origin_vault_list", input: {} },
  { name: "origin_repo_status", input: {} },
  { name: "origin_feedback", input: {} },
  { name: "origin_call_notes", input: {} },
].map((call) => ({ ...call, server: "agents" }));

const convex = await startFakeConvex();
const seeded = await seed(convex);
const env = {
  ...process.env,
  FAKE_CLAUDE_TOOL_CALLS: JSON.stringify(TOOL_CALLS),
  FAKE_CLAUDE_REPLIES: JSON.stringify(["Here is where the launch stands. The post waits for your approval."]),
};
const live = await launchVerificationServer(env);
const report: Json = { prompt: PROMPT, tools: TOOL_CALLS.map((call) => call.name), screenshots: [] as string[], checks: {} as Record<string, boolean> };
const checks = report.checks as Record<string, boolean>;
const shots = report.screenshots as string[];
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
let browser: { close(): Promise<void> } | undefined;
try {
  const api = fixtureApi(live.info.url);
  const chief = (await runControlOmb(["new-bot", "--name", "Atlas", "--url", live.info.url]) as { bot: { id: string; activeTaskId: string } }).bot;
  await api("PATCH", `/api/bots/${chief.id}`, { section: "Origin Lite" });
  await api("PATCH", `/api/bots/${chief.id}`, { chiefOfStaff: true, managedSections: ["Origin Lite"], acknowledgePeerScope: true });
  writeFileSync(join(live.info.dataDir, "origin-cloud.json"), JSON.stringify({ url: convex.url, sessionToken: seeded.token, projects: { [String(chief.id)]: seeded.projectId } }), { mode: 0o600 });
  await api("PATCH", "/api/config", { language: "en" });

  const cloud = fileURLToPath(new URL("./testing/origin-campaigns-cloud.ts", import.meta.url));
  preview = await mountPreview(live, {
    entry: "/scripts/testing/threads-preview.tsx", route: "/__origin-chat-cards.html", title: "Isolated Origin chat cards",
    extraRoutes: [{ path: "/__origin-campaigns.json", handler: (_req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ url: convex.url, token: seeded.token, viewerToken: seeded.token, projectId: seeded.projectId })); } }],
    aliases: [
      { find: /^@\/lib\/origin-cloud(?:\/client)?$/, replacement: cloud },
      { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
    ],
  });

  const sent = await api("POST", `/api/bots/${chief.id}/messages`, { text: PROMPT, threadId: chief.activeTaskId });
  void sent;
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    const bot = ((await api("GET", "/api/bots?messages=0")).bots as Json[]).find((candidate) => candidate.id === chief.id);
    if (bot && bot.busy === false && Date.now() - started > 2_000) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const messages = ((await api("GET", `/api/threads/${chief.activeTaskId}/messages`)).messages ?? []) as Json[];
  const cards = messages.filter((message) => message.originCard).map((message) => (message.originCard as Json).kind);
  report.cardsInTranscript = cards;
  checks.everyToolDrewItsCard = ["broadcast", "campaign", "assets", "vault", "repo", "feedback", "call"].every((kind) => cards.includes(kind));
  checks.vaultCardHasNoSecrets = !JSON.stringify(messages.filter((message) => message.originCard).map((message) => message.originCard)).match(/CIPHERTEXT|billing@acme|appstoreconnect/);
  const toolAnswers = messages.filter((message) => message.kind === "activity" && (message.tool as Json | undefined)?.output).map((message) => String((message.tool as Json).output));
  checks.modelNeverSawCardPayload = toolAnswers.every((output) => !output.includes("\"originCard\""));

  const playwright = await import(process.env.OMB_VERIFY_PLAYWRIGHT ? pathToFileURL(process.env.OMB_VERIFY_PLAYWRIGHT).href : "playwright") as typeof import("playwright");
  const chromium = await playwright.chromium.launch();
  browser = chromium;
  const context = await chromium.newContext({ viewport: { width: 1280, height: 1100 }, colorScheme: "dark", ignoreHTTPSErrors: true });
  await context.addInitScript(() => { try { localStorage.setItem("omb-skin", "midnight"); } catch { /* storage blocked */ } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(preview.previewUrl);
  await page.getByRole("button", { name: /Atlas/ }).first().click().catch(() => undefined);
  const card = (kind: string) => page.locator(`[data-origin-card="${kind}"]`).first();
  await card("broadcast").waitFor({ timeout: 30_000 });
  mkdirSync(EVIDENCE, { recursive: true });
  const shoot = async (kind: string, name: string) => {
    const target = card(kind);
    await target.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(400);
    const file = join(EVIDENCE, `${name}.png`);
    await target.screenshot({ path: file });
    shots.push(`docs/verification/evidence/origin-chat-cards/${name}.png`);
  };
  await shoot("broadcast", "broadcast-needs-approval");
  checks.approveOffered = await card("broadcast").getByRole("button", { name: "Approve" }).isVisible();
  checks.scheduleHiddenUntilApproved = !(await card("broadcast").getByRole("button", { name: "Schedule" }).isVisible());
  await card("broadcast").getByRole("tab", { name: "Preview on LinkedIn" }).click();
  await shoot("broadcast", "broadcast-linkedin-preview");
  await card("broadcast").getByRole("button", { name: "Approve" }).click();
  await card("broadcast").getByRole("button", { name: "Schedule" }).waitFor({ timeout: 10_000 });
  await shoot("broadcast", "broadcast-approved");
  await card("broadcast").getByRole("button", { name: "Schedule" }).click();
  await card("broadcast").getByText(/Goes out/).or(card("broadcast").getByRole("alert")).waitFor({ timeout: 10_000 });
  report.scheduleAlert = await card("broadcast").getByRole("alert").textContent().catch(() => null);
  await shoot("broadcast", "broadcast-scheduled");
  const posts = (await convex.t.query(convex.ref("broadcast:list"), { sessionToken: seeded.token, projectId: seeded.projectId }) as { posts: Json[] }).posts;
  checks.scheduledThroughApproval = posts.some((post) => post.agentName === "Atlas" && post.status === "scheduled" && typeof post.approvedAt === "number");
  await shoot("campaign", "campaign");
  await shoot("assets", "assets");
  await shoot("vault", "vault");
  await shoot("repo", "repo");
  await shoot("feedback", "feedback");
  await shoot("call", "call");
  await card("call").getByRole("button", { name: /Draft 3 issues/ }).click();
  await card("call").getByText(/ORI-/).first().waitFor({ timeout: 10_000 });
  await shoot("call", "call-drafted");
  const tasks = (await convex.t.query(convex.ref("tasks:board"), { sessionToken: seeded.token, projectId: seeded.projectId }) as { tasks: Json[] }).tasks;
  checks.callDraftedIssues = ["Fix the CSV export row bug", "Record the 30-second demo reel", "Brief two design partners"].every((title) => tasks.some((task) => task.title === title));
  await card("feedback").getByRole("button", { name: "Create issue" }).first().click();
  await page.getByRole("dialog").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(EVIDENCE, "feedback-create-issue.png") });
  shots.push("docs/verification/evidence/origin-chat-cards/feedback-create-issue.png");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const chat = page.locator("main").first();
  await chat.screenshot({ path: join(EVIDENCE, "chat.png") });
  shots.push("docs/verification/evidence/origin-chat-cards/chat.png");
  await card("assets").getByRole("button", { name: /Launch hero/ }).first().click();
  await page.locator('[data-section-page="assets"] [data-origin-item][data-origin-focused]').waitFor({ timeout: 15_000 });
  checks.assetOpensFocused = await page.evaluate(() => document.activeElement?.getAttribute("data-origin-item") !== null && document.activeElement?.closest("[data-section-page]") !== null);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(EVIDENCE, "assets-opened-focused.png") });
  shots.push("docs/verification/evidence/origin-chat-cards/assets-opened-focused.png");
  report.pageErrors = errors;
  checks.noPageErrors = errors.length === 0;
} catch (error) {
  report.error = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  process.exitCode = 1;
} finally {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
  await browser?.close();
  await preview?.close();
  await live.close();
  await convex.close();
}
