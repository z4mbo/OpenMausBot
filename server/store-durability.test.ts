import { mkdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvalModeFor } from "../shared/approval-mode.ts";
import { DATA_DIR, EVENTS_DIR } from "./config.ts";
import { closeMessageDb, chatFollowups, readThread, saveChatFollowup } from "./message-db.ts";
import { Store } from "./store.ts";

const selection = () => ({ instanceId: "claude", model: "fixture" });
function twoThreads() {
  const store = new Store(selection);
  const bot = store.createBot({}, { seedMessages: false });
  const first = store.activeTask(bot.id)!;
  store.setResumeCursor(bot.id, "claude", "first-session");
  const second = store.createTask(bot.id)!;
  store.setResumeCursor(bot.id, "claude", "second-session");
  const changed = vi.fn();
  store.onChange(changed);
  return { store, bot, first, second, changed };
}
function blockedSave(operation: () => unknown) {
  const file = join(DATA_DIR, "bots.json"), backup = file + ".fixture-before";
  const original = readFileSync(file);
  renameSync(file, backup);
  mkdirSync(file);
  let error: unknown;
  try { operation(); } catch (cause) { error = cause; }
  finally { rmdirSync(file); renameSync(backup, file); }
  expect(error).toBeInstanceOf(Error);
  const cause = (error as { cause?: unknown }).cause ?? error;
  expect((cause as { code?: string }).code).toMatch(/^(?:EISDIR|EPERM|EACCES|ENOTEMPTY)$/);
  expect(readFileSync(file)).toEqual(original);
  return error;
}

beforeEach(() => { closeMessageDb(); rmSync(DATA_DIR, { recursive: true, force: true }); });

describe("thread changes when the real bots.json replacement fails", () => {
  it("restores edited fields, active mirrors and unread state in place", () => {
    const { store, bot, second, changed } = twoThreads();
    const original = structuredClone(bot), tasks = bot.tasks;
    blockedSave(() => store.patchTask(bot.id, second.threadId, { title: "Unsaved rename", unread: true, pinnedMessageId: "unsaved-pin", resumeCursors: { claude: "unsaved-session" } }));
    expect(bot).toEqual(original);
    expect(bot.tasks).toBe(tasks);
    expect(store.taskByThread(bot.id, second.threadId)).toBe(second);
    expect(changed).not.toHaveBeenCalled();
  });

  it.each([
    ["new thread", ({ store, bot }: ReturnType<typeof twoThreads>) => store.createTask(bot.id, "Unsaved thread")],
    ["thread switch", ({ store, bot, first }: ReturnType<typeof twoThreads>) => store.switchTask(bot.id, first.threadId)],
    ["folder pin", ({ store, bot, second }: ReturnType<typeof twoThreads>) => store.pinTaskCwd(bot.id, second.threadId, "/synthetic/project")],
    ["opener", ({ store, bot, second }: ReturnType<typeof twoThreads>) => store.setTaskOpenedBy(bot.id, second.threadId, { botId: "chief", name: "Fixture Chief", kind: "work", at: 1 })],
    ["closer", ({ store, bot, second }: ReturnType<typeof twoThreads>) => store.setTaskClosedBy(bot.id, second.threadId, { botId: "chief", name: "Fixture Chief", at: 1 })],
    ["first title", ({ store, bot, second }: ReturnType<typeof twoThreads>) => store.titleTaskFromFirstMessage(bot.id, "Unsaved first title", second.threadId)],
  ])("does not apply an unsaved %s", (_name, change) => {
    const fixture = twoThreads(), original = structuredClone(fixture.bot), tasks = fixture.bot.tasks;
    blockedSave(() => change(fixture));
    expect(fixture.bot).toEqual(original);
    expect(fixture.bot.tasks).toBe(tasks);
    expect(fixture.changed).not.toHaveBeenCalled();
  });

  it.each([
    { approvalMode: "full" as const },
    { alwaysAllow: ["Read", "Bash"] },
  ])("never activates a failed permission widening %j", (patch) => {
    const { store, bot, second } = twoThreads();
    store.patchTask(bot.id, second.threadId, { approvalMode: "ask", autoApprove: false, alwaysAllow: ["Read"] });
    blockedSave(() => store.patchTask(bot.id, second.threadId, patch));
    expect(approvalModeFor(store.projectBotForTask(bot.id, second.threadId)!)).toBe("ask");
    expect(second.alwaysAllow).toEqual(["Read"]);
    expect(new Store(selection).taskByThread(bot.id, second.threadId)?.approvalMode).toBe("ask");
  });

  it("retains an approval revocation while rolling back an unrelated failed edit", () => {
    const { store, bot, second } = twoThreads();
    store.patchTask(bot.id, second.threadId, { approvalMode: "full", alwaysAllow: ["Read", "Bash"] });
    const title = second.title;
    blockedSave(() => store.patchTask(bot.id, second.threadId, { approvalMode: "ask", autoApprove: false, alwaysAllow: ["Read"], title: "Unsaved rename" }));
    expect(second).toMatchObject({ approvalMode: "ask", autoApprove: false, alwaysAllow: ["Read"], title });
    expect(new Store(selection).taskByThread(bot.id, second.threadId)?.approvalMode).toBe("full");
  });

  it("retains the narrower part of a mixed approval change without its new allow-list grant", () => {
    const { store, bot, second } = twoThreads();
    store.patchTask(bot.id, second.threadId, { approvalMode: "full", alwaysAllow: ["Read"] });
    blockedSave(() => store.patchTask(bot.id, second.threadId, { approvalMode: "ask", autoApprove: false, alwaysAllow: ["Read", "Bash"] }));
    expect(second).toMatchObject({ approvalMode: "ask", autoApprove: false, alwaysAllow: ["Read"] });
  });

  it("does not treat a custom provider policy as broader than Full access", () => {
    const { store, bot, second } = twoThreads();
    store.patchTask(bot.id, second.threadId, { approvalMode: "custom", alwaysAllow: ["Read"] });
    blockedSave(() => store.patchTask(bot.id, second.threadId, { approvalMode: "full" }));
    expect(second.approvalMode).toBe("custom");
  });

  it("does not widen an inherited allow-list while retaining its requested removals", () => {
    const { store, bot, second } = twoThreads();
    store.patchBot(bot.id, { alwaysAllow: ["Read", "Bash"] });
    store.patchTask(bot.id, second.threadId, { alwaysAllow: undefined });
    blockedSave(() => store.patchTask(bot.id, second.threadId, { alwaysAllow: ["Read", "Write"] }));
    expect(store.projectBotForTask(bot.id, second.threadId)?.alwaysAllow).toEqual(["Read"]);
  });

  it.each([{ sharedPrivate: true as const }, { shared: undefined }])("keeps Origin sharing revocation %j effective", (patch) => {
    const { store, bot, second } = twoThreads();
    store.patchTask(bot.id, second.threadId, { shared: { cloudThreadId: "fixture-cloud-thread" } });
    blockedSave(() => store.patchTask(bot.id, second.threadId, patch));
    expect(second).toMatchObject(patch);
  });

  it("keeps deleted conversations, queued work and event files when bots.json cannot be saved", () => {
    const { store, bot, first, second, changed } = twoThreads();
    store.appendMessage(second.threadId, { role: "user", kind: "text", text: "Keep the synthetic conversation" });
    saveChatFollowup({ id: "fixture-followup", kind: "bot", ownerId: bot.id, threadId: second.threadId, payload: { text: "Keep the queued message" } });
    mkdirSync(EVENTS_DIR, { recursive: true });
    const eventFile = join(EVENTS_DIR, `${second.threadId}.ndjson`);
    writeFileSync(eventFile, "{}\n");
    changed.mockClear();
    blockedSave(() => store.deleteTasks(bot.id, [second.threadId]));
    expect(readThread(second.threadId, "").messages.map(message => message.text)).toEqual(["Keep the synthetic conversation"]);
    expect(chatFollowups().map(message => message.id)).toContain("fixture-followup");
    expect(readFileSync(eventFile, "utf8")).toBe("{}\n");
    expect(store.tasks(bot.id).map(task => task.threadId)).toEqual([second.threadId, first.threadId]);
    expect(changed).not.toHaveBeenCalled();
    const restored = new Store(selection);
    expect(restored.messagesFor(second.threadId).map(message => message.text)).toEqual(["Keep the synthetic conversation"]);
    expect(store.deleteTasks(bot.id, [second.threadId])?.deleted).toEqual([second.threadId]);
    expect(new Store(selection).tasks(bot.id).map(task => task.threadId)).toEqual([first.threadId]);
    expect(readThread(second.threadId, "").messages).toEqual([]);
    expect(chatFollowups().map(message => message.id)).not.toContain("fixture-followup");
  });

  it("retains already observed engine sessions and message timestamps for the next successful save", () => {
    const { store, bot, second } = twoThreads();
    blockedSave(() => store.setResumeCursor(bot.id, "claude", "observed-session"));
    expect(second.resumeCursors.claude).toBe("observed-session");
    blockedSave(() => store.setTaskAskedAt(bot.id, second.threadId, 1234));
    expect(second.askedAt).toBe(1234);
    store.patchTask(bot.id, second.threadId, { title: "Next successful edit" });
    expect(new Store(selection).taskByThread(bot.id, second.threadId)).toMatchObject({ resumeCursors: { claude: "observed-session" }, askedAt: 1234 });
  });
});
