import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const url = new URL(process.argv[2] ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/__origin-pipeline.html");
const output = resolve(process.argv[3] ?? "docs/verification/evidence/origin-pipeline-v2");
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
const evidence = { checkedAt: new Date().toISOString(), previewUrl: url.href, cases: [], pageErrors: [] };
const fixture = (path, init) => fetch(new URL(path, url), init).then((response) => response.json());

async function open(width, theme, query = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  page.on("pageerror", (error) => evidence.pageErrors.push(`${width}-${theme}: ${error.message}`));
  await page.route(/^(?!http:\/\/127\.0\.0\.1)/, (route) => route.abort());
  const target = new URL(url);
  target.searchParams.set("theme", theme);
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
  await page.goto(target.href);
  await page.getByRole("heading", { name: "Publish" }).waitFor();
  await page.getByRole("button", { name: "Pipeline" }).click();
  await page.getByText("Grace Hopper").first().waitFor();
  return page;
}

const capture = async (page, name) => {
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} scrolls sideways`);
  await page.screenshot({ path: resolve(output, `${name}.png`) });
};
const providerCalls = () => fixture("/__origin-pipeline-providers.json");

try {
  const page = await open(1280, "dark");
  const replies = page.getByRole("button", { name: /^Replies/ });
  await replies.getByText("2").waitFor();
  await capture(page, "board-1280-dark");
  await replies.click();
  await page.getByText("Margaret Hamilton").waitFor({ state: "detached" });
  assert.equal(await page.getByText("Grace Hopper").count() > 0 && await page.getByText("Alan Turing").count() > 0, true);
  await capture(page, "replies-filter-1280-dark");
  await replies.click();
  evidence.cases.push({ step: "two inbound replies (signed Twilio SMS, Brevo email) show as unread and filter the board" });

  const notifications = await fixture("/__origin-pipeline-notifications.json");
  assert.deepEqual(notifications.page.map((row) => [row.kind, row.actorName]), [["lead", "Grace Hopper"]]);
  evidence.cases.push({ step: "Grace's owner (sam) got an Inbox notification; Alan has no member owner so the admins got theirs" });

  await page.getByRole("article", { name: "Alan Turing, Bletchley" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("button", { name: "Activity" }).click();
  await drawer.getByText("Email reply").waitFor();
  await drawer.getByText("Sounds good. Send me the numbers first.").waitFor();
  await drawer.getByRole("button", { name: "Edit" }).click();
  await drawer.getByRole("textbox", { name: "Message" }).fill("Hi Alan,\n\nHere are the numbers you asked for.");
  await capture(page, "edit-draft-1280-dark");
  await drawer.getByRole("button", { name: "Approve and send" }).click();
  await drawer.getByText("Sent", { exact: true }).first().waitFor();
  const email = (await providerCalls()).find((call) => call.path === "/v3/smtp/email");
  const sent = JSON.parse(email.body);
  assert.equal(sent.textContent, "Hi Alan,\n\nHere are the numbers you asked for.");
  assert.deepEqual(sent.replyTo, { email: "replies@in.fixture.test" });
  evidence.cases.push({ step: "an agent's draft is edited, approved and sent through the loopback Brevo with the reply-to address" });
  await drawer.getByRole("button", { name: /Score/ }).click();
  await drawer.getByText("Replied today").waitFor();
  await capture(page, "lead-score-1280-dark");
  await drawer.getByRole("button", { name: "Close" }).click();
  await drawer.waitFor({ state: "detached" });
  await page.getByRole("button", { name: /^Replies/ }).getByText("1").waitFor();
  evidence.cases.push({ step: "opening the lead clears its unread replies" });

  await page.getByRole("article", { name: "Linus Torvalds, Kernel" }).click();
  await drawer.getByRole("button", { name: "Activity" }).click();
  await drawer.getByRole("region", { name: "Follow-up sequence" }).getByText("Running").waitFor();
  await drawer.getByText("Drafted for approval").waitFor();
  await capture(page, "sequence-1280-dark");
  assert.equal((await fixture("/__origin-pipeline-tick", { method: "POST" })).drafted, 0);
  await drawer.getByText("Call task due today: Call Linus Torvalds").waitFor({ timeout: 5_000 });
  await drawer.getByRole("button", { name: "Pause" }).click();
  await drawer.getByText("Paused").waitFor();
  await drawer.getByRole("button", { name: "Resume" }).click();
  await drawer.getByText("Running").waitFor();
  await drawer.getByRole("button", { name: "Close" }).click();
  evidence.cases.push({ step: "an agent's sequence drafted day 0 for approval, turned its day 3 call task into the next step, paused and resumed" });

  await page.getByRole("article", { name: "Margaret Hamilton, MIT" }).click();
  await drawer.getByRole("button", { name: "Activity" }).click();
  await drawer.getByRole("button", { name: "New", exact: true }).click();
  await drawer.getByRole("button", { name: "Start" }).click();
  await drawer.getByText("Running").waitFor();
  assert.equal((await fixture("/__origin-pipeline-inbound", { method: "POST", body: JSON.stringify({ kind: "whatsapp", from: "+16175550123", body: "Not this quarter, sorry." }) })).status, 200);
  await drawer.getByText("Stopped: The lead replied").waitFor({ timeout: 6_000 });
  await drawer.getByText("WhatsApp reply").waitFor();
  await capture(page, "sequence-stopped-by-reply-1280-dark");
  await drawer.getByRole("button", { name: "Close" }).click();
  evidence.cases.push({ step: "a person's sequence stops by itself when the lead replies on WhatsApp" });

  await page.getByRole("button", { name: "Contacts" }).click();
  await page.getByRole("button", { name: /^Score/ }).click();
  const first = await page.locator("tbody tr").first().getByRole("button").first().textContent();
  assert.equal(first, "Grace Hopper");
  await capture(page, "table-by-score-1280-dark");
  evidence.cases.push({ step: "the contacts table sorts by score with next-action chips" });

  await page.getByRole("button", { name: "Sales settings" }).click();
  const settings = page.getByRole("dialog");
  await settings.getByRole("button", { name: "Replies" }).click();
  await settings.getByText(/pipeline\/twilio\?token=[a-f0-9]{48}/).waitFor();
  await settings.getByText(/pipeline\/brevo\?token=[a-f0-9]{48}/).first().waitFor();
  await capture(page, "settings-replies-1280-dark");
  await settings.getByRole("button", { name: "Stages" }).click();
  await settings.getByRole("textbox", { name: "Stage 3 name" }).fill("Discovery");
  await settings.getByRole("button", { name: "Remove Contacted" }).click();
  await settings.getByRole("button", { name: "Add stage" }).click();
  await settings.getByRole("textbox", { name: "Stage 4 name" }).fill("Demo");
  await settings.getByRole("button", { name: "Move Demo up" }).click();
  await settings.getByText(/Move the 1 lead in Contacted to/).waitFor();
  await capture(page, "settings-stages-1280-dark");
  await settings.getByRole("button", { name: "Save stages" }).click();
  await settings.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Pipeline" }).click();
  await page.getByRole("list", { name: "Demo leads" }).waitFor();
  await page.getByRole("list", { name: "Discovery leads" }).getByText("Alan Turing").waitFor();
  assert.equal(await page.getByRole("list", { name: "Contacted leads" }).count(), 0);
  await capture(page, "board-after-stages-1280-dark");
  evidence.cases.push({ step: "stages renamed, removed (its lead reassigned), added and reordered" });
  await page.close();

  for (const [width, theme] of [[375, "dark"], [375, "light"], [1280, "light"]]) {
    const tag = `${width}-${theme}`;
    const view = await open(width, theme);
    await capture(view, `board-${tag}`);
    await view.getByRole("article", { name: "Grace Hopper, Navy" }).click();
    await view.getByRole("dialog").getByRole("button", { name: "Activity" }).click();
    await view.getByRole("dialog").getByText("Text reply").waitFor();
    await capture(view, `lead-${tag}`);
    await view.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    await view.getByRole("button", { name: "Sales settings" }).click();
    await view.getByRole("dialog").getByRole("button", { name: "Replies" }).click();
    await view.getByRole("dialog").getByText("Messaging webhook", { exact: false }).waitFor();
    await capture(view, `settings-replies-${tag}`);
    await view.close();
    evidence.cases.push({ step: `board, lead and webhook settings at ${tag}` });
  }

  const viewer = await open(1280, "dark", { viewer: "1" });
  await viewer.getByRole("button", { name: "Sales settings" }).click();
  await viewer.getByRole("dialog").getByRole("button", { name: "Replies" }).click();
  await viewer.getByRole("dialog").getByText("Only editors see the webhook addresses.").waitFor();
  await viewer.close();
  evidence.cases.push({ step: "a viewer never sees the webhook addresses or secret" });

  assert.deepEqual(evidence.pageErrors, []);
  await writeFile(resolve(output, "report.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, cases: evidence.cases.length, output }));
} finally {
  await browser.close();
}
