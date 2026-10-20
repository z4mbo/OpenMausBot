import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const url = new URL(process.argv[2] ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/__origin-pipeline.html");
const output = resolve(process.argv[3] ?? "docs/verification/evidence/origin-sales");
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
const evidence = { checkedAt: new Date().toISOString(), previewUrl: url.href, cases: [], pageErrors: [] };
const fixture = (path, init) => fetch(new URL(path, url), init).then((response) => response.json());
const providerCalls = () => fixture("/__origin-pipeline-providers.json");
const step = (text) => evidence.cases.push({ step: text });
async function nextCall(match, after) {
  for (let tries = 0; tries < 60; tries++) {
    const found = (await providerCalls()).filter(match);
    if (found.length > after) return found.at(-1);
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error("The provider never got the request");
}
const isEmail = (call) => call.path === "/v3/smtp/email";

async function open(width, theme, query = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce", acceptDownloads: true });
  page.on("pageerror", (error) => evidence.pageErrors.push(`${width}-${theme}: ${error.message}`));
  await page.route(/^(?!http:\/\/127\.0\.0\.1)/, (route) => route.abort());
  const target = new URL(url);
  target.searchParams.set("theme", theme);
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
  await page.goto(target.href);
  await page.getByRole("heading", { name: "Publish" }).waitFor();
  await page.getByRole("group", { name: "Publish section" }).getByRole("button", { name: /Sales/, pressed: true }).waitFor();
  return page;
}

const capture = async (page, name) => {
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} scrolls sideways`);
  await page.screenshot({ path: resolve(output, `${name}.png`) });
};

try {
  const warm = await open(1280, "dark");
  await warm.waitForLoadState("networkidle");
  await warm.waitForTimeout(3_000);
  await warm.close();
  const page = await open(1280, "dark");
  const list = page.getByRole("complementary", { name: "Conversations" });
  const thread = (name) => page.getByRole("region", { name: `Conversation with ${name}` }).first();
  await list.getByRole("button", { name: /Alan Turing/ }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Inbox/ }).textContent(), "Inbox2");
  await list.getByRole("button", { name: "Show older" }).waitFor({ timeout: 30_000 });
  assert.ok(await list.locator("[data-lead-id]").count() <= 33, "the first page holds at most one page of conversations plus the ones that need someone");
  assert.equal(await list.getByRole("button", { name: /Prospect 36/ }).count(), 0);
  await capture(page, "inbox-1280-dark");
  await capture(page, "round5-inbox-1280-dark");
  await list.getByRole("button", { name: "Show older" }).click();
  await list.getByRole("button", { name: /Prospect 36/ }).waitFor();
  await list.getByRole("button", { name: "Show older" }).waitFor({ state: "detached" });
  step("the inbox files older contacts once, shows a page of conversations, and pages past it for older ones");

  await list.getByRole("button", { name: /Grace Hopper/ }).click();
  await thread("Grace Hopper").getByText("Grace here. Can we move the call to Thursday?").waitFor();
  await page.getByRole("button", { name: /^Inbox\s*1$/ }).waitFor();
  const graceReply = thread("Grace Hopper").getByRole("form", { name: "Reply" });
  assert.equal(await graceReply.getByRole("button", { name: "Text", exact: true }).getAttribute("aria-pressed"), "true");
  await graceReply.getByRole("textbox", { name: "Reply" }).fill("Thursday works, Grace. 10am?");
  await graceReply.getByRole("button", { name: "Send" }).click();
  await thread("Grace Hopper").getByText("Sent the text to Grace Hopper.").waitFor();
  const sms = (await providerCalls()).filter((call) => call.path.endsWith("/Messages.json")).at(-1);
  assert.equal(new URLSearchParams(sms.body).get("Body"), "Thursday works, Grace. 10am?");
  step("opening a conversation clears its unread reply; a reply goes out on the channel the contact last used (Twilio SMS)");

  await list.getByRole("button", { name: /Alan Turing/ }).click();
  const alan = thread("Alan Turing");
  await alan.getByText("Atlas says").waitFor();
  await capture(page, "inbox-thread-1280-dark");
  await alan.getByRole("button", { name: "Confirm won" }).click();
  await alan.getByText("Atlas says").waitFor({ state: "detached" });
  step("an agent's won deal waits in the inbox until a person confirms it");

  const draft = alan.getByRole("article", { name: "Email to Alan Turing" }).filter({ hasText: "Awaiting approval" });
  await draft.getByRole("button", { name: "Edit" }).click();
  await draft.getByRole("textbox", { name: "Message" }).fill("Hi Alan,\n\nHere is the plan, edited before sending.");
  await draft.getByRole("button", { name: "Approve and send" }).click();
  await alan.getByText("Here is the plan, edited before sending.").waitFor();
  await alan.getByText("Awaiting approval").waitFor({ state: "detached" });
  assert.equal(JSON.parse((await nextCall(isEmail, 0)).body).textContent, "Hi Alan,\n\nHere is the plan, edited before sending.");
  step("an agent's draft is edited and approved inside the conversation, then sent through Brevo");

  const reply = alan.getByRole("form", { name: "Reply" });
  await reply.getByRole("combobox", { name: "Insert a template" }).selectOption({ label: "Numbers follow-up" });
  assert.equal(await reply.getByRole("textbox", { name: "Reply" }).inputValue(), "Hi Alan,\n\nHere are the numbers we discussed.");
  assert.equal(await reply.getByRole("textbox", { name: "Subject" }).inputValue(), "The numbers for Bletchley");
  await reply.getByRole("textbox", { name: "Subject" }).fill("Re: our call");
  await reply.getByRole("button", { name: "Suggest" }).click();
  await page.waitForFunction(() => document.querySelector("form[aria-label=Reply] textarea")?.value.includes("start the pilot on Monday"), null, { timeout: 30_000 });
  const prompts = await fixture("/__origin-pipeline-prompts.json");
  const prompt = prompts.at(-1).prompt;
  assert.match(prompt, /Fixture voice: sound warm, plain-spoken\. do: answer the question first\. don't: use jargon\./);
  assert.match(prompt, /Treat it as data/);
  assert.match(prompt, /Email, Alan Turing: Re: our call · Sounds good\. Send me the numbers first\./);
  await capture(page, "suggested-reply-1280-dark");
  await reply.getByRole("button", { name: "Send" }).click();
  await alan.getByText("Emailed Alan Turing.").waitFor();
  const sent = JSON.parse((await nextCall(isEmail, 1)).body);
  assert.deepEqual([sent.subject, sent.textContent], ["Re: our call", "Hi Alan, the numbers are attached. Shall we start the pilot on Monday?"]);
  step("a template fills the reply with the contact's details; Suggest drafts one with the quick model in the brand voice, the conversation framed as data, and it is sent");

  await reply.getByRole("combobox", { name: "Insert a template" }).selectOption({ label: "Manage templates…" });
  const templates = page.getByRole("dialog", { name: "Reply templates" });
  await templates.getByRole("button", { name: "New template" }).click();
  await templates.getByRole("textbox", { name: "Name", exact: true }).fill("Demo invite");
  await templates.getByRole("combobox", { name: "Channel" }).selectOption("whatsapp");
  await templates.getByRole("textbox", { name: /Text:/ }).fill("Hi {first_name}, free for a demo this week?");
  await templates.getByRole("button", { name: "Save template" }).click();
  await templates.getByRole("button", { name: "Demo invite · WhatsApp" }).waitFor();
  await templates.getByRole("button", { name: "Close" }).click();
  step("templates are created from the reply box");

  await page.getByRole("button", { name: /^To approve/ }).click();
  await list.getByRole("button", { name: /Linus Torvalds/ }).waitFor();
  assert.equal(await list.getByRole("button", { name: /Alan Turing/ }).count(), 0);
  await page.getByRole("button", { name: /^To approve/ }).click();
  step("the inbox filters to conversations that need an approval");

  const selected = () => list.locator("[aria-current=true]").getAttribute("data-lead-id");
  await list.getByRole("button", { name: /Grace Hopper/ }).click();
  await thread("Grace Hopper").waitFor();
  const graceId = await selected();
  await page.keyboard.press("j");
  assert.notEqual(await selected(), graceId);
  await page.keyboard.press("k");
  assert.equal(await selected(), graceId);
  await thread("Grace Hopper").getByRole("form", { name: "Reply" }).waitFor();
  await page.keyboard.press("r");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Reply", null, { timeout: 5_000 }).catch(async () => { throw new Error(`r focused ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 200))}`); });
  await page.evaluate(() => document.activeElement?.blur());
  await thread("Grace Hopper").getByRole("combobox", { name: "Assign to" }).selectOption({ label: "sam" });
  await page.getByText("Assigned Grace Hopper to sam.").waitFor();
  step("j and k move through conversations, r jumps to the reply box, and a conversation is assigned to a member");

  await list.getByRole("button", { name: /Alan Turing/ }).click();
  await thread("Alan Turing").waitFor();
  await page.keyboard.press("s");
  const snooze = page.getByRole("menu", { name: "Snooze until" });
  await snooze.getByRole("menuitem", { name: /Tomorrow morning/ }).waitFor();
  await capture(page, "round5-inbox-snooze-1280-dark");
  await snooze.getByRole("menuitem", { name: /Tomorrow morning/ }).click();
  await page.getByText("Snoozed Alan Turing until").waitFor();
  assert.equal(await list.getByRole("button", { name: /Alan Turing/ }).count(), 0);
  await list.getByRole("button", { name: /Grace Hopper/ }).click();
  await page.keyboard.press("e");
  await page.getByText("Archived Grace Hopper.").waitFor();
  assert.equal(await list.getByRole("button", { name: /Grace Hopper/ }).count(), 0);
  await page.getByRole("group", { name: "Folder" }).getByRole("button", { name: "Snoozed" }).click();
  await list.getByRole("button", { name: /Alan Turing/ }).waitFor();
  await thread("Alan Turing").getByRole("button", { name: "Move to inbox" }).click();
  await page.getByRole("group", { name: "Folder" }).getByRole("button", { name: "Archived" }).click();
  await list.getByRole("button", { name: /Grace Hopper/ }).click();
  await page.keyboard.press("e");
  await page.getByText("Moved Grace Hopper to the inbox.").waitFor();
  await page.getByRole("group", { name: "Folder" }).getByRole("button", { name: "Open" }).click();
  await list.getByRole("button", { name: /Grace Hopper/ }).waitFor();
  await list.getByRole("button", { name: /Alan Turing/ }).waitFor();
  step("s snoozes a conversation out of the inbox, e archives it, and both come back from their folders");

  await page.getByRole("button", { name: "Contacts" }).click();
  await page.getByText(/Last captured (just now|.* ago) · 1 today/).waitFor();
  await page.getByRole("button", { name: "1 possible duplicate" }).click();
  const merge = page.getByRole("dialog", { name: "Possible duplicates" });
  await merge.getByText("Keep").waitFor();
  await capture(page, "merge-1280-dark");
  await merge.getByRole("button", { name: "Merge 2" }).click();
  await merge.getByText("No duplicates left.").waitFor();
  await merge.getByRole("button", { name: "Done" }).click();
  assert.equal(await page.getByRole("button", { name: "G. Hopper" }).count(), 0);
  const notes = await fixture("/__origin-pipeline-notifications.json");
  assert.ok(notes.page.length > 0);
  assert.ok(notes.page.every((row) => row.kind !== "lead" || row.available), "every lead notification still opens a contact that exists");
  step("two contacts sharing a phone number merge into one, keeping both sources, and their notifications still open it");

  await page.getByRole("combobox", { name: "Source" }).selectOption("fixture-app");
  await page.locator("tbody tr").first().getByText("Ada Lovelace").waitFor();
  assert.equal(await page.locator("tbody tr").count(), 1);
  await page.getByRole("button", { name: "Save view" }).click();
  await page.getByRole("dialog", { name: "Save view" }).getByRole("textbox", { name: "Name" }).fill("App signups");
  await page.getByRole("dialog", { name: "Save view" }).getByRole("button", { name: "Save view" }).click();
  await page.getByRole("button", { name: "App signups", exact: true }).waitFor();
  await page.getByRole("button", { name: /^All contacts/ }).click();
  assert.ok(await page.locator("tbody tr").count() > 5);
  await page.getByRole("button", { name: "App signups", exact: true }).click();
  assert.equal(await page.locator("tbody tr").count(), 1);
  step("filters save as a shared view and apply again from its chip");

  await page.getByRole("button", { name: /^All contacts/ }).click();
  await page.getByRole("checkbox", { name: "Select Ada Lovelace" }).check();
  await page.getByRole("checkbox", { name: "Select Barbara Liskov" }).check();
  const bulk = page.getByRole("toolbar", { name: "Bulk actions" });
  await bulk.getByRole("textbox", { name: "Tag to add" }).fill("q4");
  await bulk.getByRole("textbox", { name: "Tag to add" }).press("Enter");
  await page.getByText("Updated 2 contacts.").waitFor();
  await bulk.getByRole("combobox", { name: "Assign to" }).selectOption({ label: "sam" });
  await page.getByText("Updated 2 contacts.").waitFor();
  await bulk.getByRole("button", { name: "Start sequence" }).click();
  await page.getByText(/Started 2 sequences/).waitFor();
  await capture(page, "contacts-bulk-1280-dark");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export 2" }).click();
  const csv = await readFile(await (await download).path(), "utf8");
  const rows = csv.trim().split("\r\n");
  assert.equal(rows[0], "name,company,email,phone,stage,value,owner,tags,sources,next step,next due,created");
  assert.equal(rows.length, 3);
  assert.match(csv, /Ada Lovelace,,ada@engines\.test,,New,,sam,q4,fixture-app/);
  step("bulk tag, assign and start a sequence on selected contacts, and export them as CSV");

  await page.getByRole("button", { name: "Lead capture" }).click();
  const captureDialog = page.getByRole("dialog", { name: "Capture contacts" });
  await captureDialog.getByRole("button", { name: "API" }).click();
  await captureDialog.getByText(/curl -X POST ".*\/pipeline\/capture\?token=[a-f0-9]{48}"/).waitFor();
  await captureDialog.getByText(/Last captured (just now|.* ago) · 1 in 24 hours · 1 in 30 days/).waitFor();
  await capture(page, "capture-api-1280-dark");
  await captureDialog.getByRole("button", { name: "Close" }).click();
  step("the capture dialog documents the public API and webhook address and shows when it last captured");

  await page.getByRole("button", { name: "Deals" }).click();
  await page.getByText("Navy annual plan").waitFor();
  await page.getByText(/Kept apart, not converted: \$2,500 open/).waitFor();
  await page.getByRole("button", { name: /^Won/ }).click();
  await page.getByText("Bletchley pilot").waitFor();
  await page.getByRole("button", { name: /^Open/ }).click();
  step("deals in another currency are summed apart instead of being added to the euro totals");
  await page.getByRole("button", { name: "New deal" }).click();
  const newDeal = page.getByRole("dialog", { name: "New deal" });
  await newDeal.getByRole("combobox", { name: "Contact" }).selectOption({ label: "Linus Torvalds · Kernel" });
  await newDeal.getByRole("textbox", { name: "Deal" }).fill("Kernel support");
  await newDeal.getByRole("button", { name: "Open deal" }).click();
  const drawer = page.getByRole("dialog", { name: "Linus Torvalds" });
  const card = drawer.getByRole("article", { name: "Deal Kernel support" });
  await card.getByRole("button", { name: "Edit Kernel support" }).click();
  const editor = drawer.getByRole("form", { name: "Edit Kernel support" });
  await editor.getByRole("button", { name: "Add product" }).click();
  await editor.getByRole("textbox", { name: "Product 1" }).fill("Support hours");
  await editor.getByRole("textbox", { name: "Quantity 1" }).fill("10");
  await editor.getByRole("textbox", { name: "Unit price 1" }).fill("90");
  await editor.getByRole("textbox", { name: "Expected close" }).fill("2026-11-30");
  await editor.getByRole("button", { name: "Save deal" }).click();
  await card.getByText("€900").first().waitFor();
  await card.getByRole("button", { name: "Payment link" }).click();
  await card.getByRole("link", { name: /buy.stripe.com/ }).waitFor();
  const stripeCalls = (await providerCalls()).filter((call) => call.path.startsWith("/v1/"));
  assert.deepEqual(Object.fromEntries(new URLSearchParams(stripeCalls[0].body)), { currency: "eur", unit_amount: "9000", "product_data[name]": "Support hours" });
  assert.equal(new URLSearchParams(stripeCalls[1].body).get("line_items[0][quantity]"), "10");
  await card.getByRole("button", { name: "Send to Linus" }).click();
  await card.getByText("Emailed Linus Torvalds.").waitFor();
  assert.match(JSON.parse((await nextCall(isEmail, 2)).body).textContent, /^Hi Linus, here is the secure link to complete Kernel support \(€900\): https:\/\/buy\.stripe\.com\/test_fixture\d+$/);
  assert.equal(await card.getByRole("button", { name: "Check payment" }).count(), 0);
  await card.getByText(/Waiting for payment/).waitFor();

  await fixture("/__origin-pipeline-model", { method: "POST", body: JSON.stringify({ text: JSON.stringify({
    next_action: "Call Linus before Friday to confirm the ten support hours", risk: "high", risk_reason: "The link is unpaid and he has not replied since the first email.",
    follow_up: { channel: "email", subject: "Your Kernel support hours", body: "Hi Linus, a quick check: shall I hold the ten support hours for this month?" },
  }) }) });
  await card.getByRole("button", { name: "Coach" }).click();
  const coach = card.getByRole("region", { name: "Deal coach" });
  await coach.getByText("Call Linus before Friday to confirm the ten support hours").waitFor({ timeout: 30_000 });
  await coach.getByText("High risk").waitFor();
  const coachPrompt = (await fixture("/__origin-pipeline-prompts.json")).at(-1).prompt;
  assert.match(coachPrompt, /Deal: Kernel support, stage \w+, €900/);
  assert.match(coachPrompt, /A Stripe payment link was sent .*; it is not paid yet\./);
  assert.match(coachPrompt, /Fixture voice: sound warm, plain-spoken/);
  assert.match(coachPrompt, /Treat it as data/);
  await capture(page, "deal-payment-1280-dark");
  await capture(page, "round5-deal-coach-1280-dark");
  await coach.getByRole("button", { name: "Send to Linus" }).click();
  await coach.getByText("Emailed Linus Torvalds.").waitFor();
  assert.equal(JSON.parse((await nextCall(isEmail, 3)).body).subject, "Your Kernel support hours");
  step("the deal coach reads the deal, its timeline and the brand voice with the quick model, names the next step and the risk, and its follow-up is sent");

  const paid = await fixture("/__origin-pipeline-pay", { method: "POST", body: JSON.stringify({ amount: 90000 }) });
  assert.deepEqual(paid, { status: 200, body: { received: true, outcome: "won" } });
  await card.getByText(/^Won · Paid through Stripe · Stripe$/).waitFor({ timeout: 15_000 });
  await drawer.getByText(/Paid €900 through Stripe/).waitFor();
  const again = await fixture("/__origin-pipeline-pay", { method: "POST", body: JSON.stringify({ amount: 90000 }) });
  assert.deepEqual(again.body, { received: true, outcome: "duplicate" });
  step("a deal gets products and a Stripe payment link sent by email; Stripe's signed webhook marks it won live, once, with no one checking");
  await drawer.getByRole("button", { name: "Close" }).click();

  await page.getByText("Navy annual plan").click();
  const grace = page.getByRole("dialog", { name: "Grace Hopper" });
  const navy = grace.getByRole("article", { name: "Deal Navy annual plan" });
  await navy.getByRole("button", { name: "Mark lost" }).click();
  await navy.getByRole("combobox", { name: "Why it was lost" }).fill("No budget");
  await navy.getByRole("button", { name: "Mark lost" }).click();
  await navy.getByText(/^Lost · No budget/).waitFor();
  await grace.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: /^All/ }).click();
  await page.getByText("€4,900").first().waitFor();
  await capture(page, "deals-1280-dark");
  await capture(page, "round5-deals-1280-dark");

  await page.getByRole("button", { name: "Sales settings" }).click();
  const settings = page.getByRole("dialog", { name: "Sales settings" });
  await settings.getByRole("button", { name: "Payments" }).click();
  await settings.getByText(/\/pipeline\/stripe\?token=[a-f0-9]{48}/).waitFor();
  await settings.getByText("Payments mark deals won as they arrive.").waitFor();
  await capture(page, "round5-stripe-webhook-1280-dark");
  await settings.getByRole("button", { name: "Close" }).click();
  step("Sales settings show the Stripe webhook address and that its signing secret is stored, never the secret");
  step("a deal is lost with its reason; won totals count the confirmed pilot and the paid deal");
  await page.close();

  for (const [width, theme] of [[375, "dark"], [375, "light"], [1280, "light"]]) {
    const tag = `${width}-${theme}`;
    const view = await open(width, theme);
    await capture(view, `inbox-${tag}`);
    if (width < 768) {
      await view.getByRole("complementary", { name: "Conversations" }).getByRole("button", { name: /Grace Hopper/ }).click();
      await view.getByRole("button", { name: "Back to conversations" }).waitFor();
      await capture(view, `thread-${tag}`);
      await view.getByRole("button", { name: "Back to conversations" }).click();
    }
    await view.getByRole("button", { name: "Contacts" }).click();
    await view.locator("tbody tr").first().waitFor();
    await capture(view, `contacts-${tag}`);
    await view.getByRole("button", { name: "Deals" }).click();
    await capture(view, `deals-${tag}`);
    await view.getByRole("button", { name: /^All/ }).click();
    await view.getByText("Kernel support").click();
    await view.getByRole("dialog", { name: "Linus Torvalds" }).getByRole("article", { name: "Deal Kernel support" }).waitFor();
    await capture(view, `deal-drawer-${tag}`);
    await view.close();
    step(`inbox, conversation, contacts, deals and the deal drawer at ${tag}`);
  }

  const viewer = await open(1280, "dark", { viewer: "1" });
  await viewer.getByRole("complementary", { name: "Conversations" }).getByRole("button", { name: /Grace Hopper/ }).click();
  await viewer.getByText("Thursday works, Grace. 10am?").waitFor();
  assert.equal(await viewer.getByRole("form", { name: "Reply" }).count(), 0);
  assert.equal(await viewer.getByRole("button", { name: "Approve and send" }).count(), 0);
  await viewer.close();
  step("a viewer reads conversations but cannot reply or approve");

  assert.deepEqual(evidence.pageErrors, []);
  await writeFile(resolve(output, "report.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, cases: evidence.cases.length, output }));
} finally {
  await browser.close();
}
