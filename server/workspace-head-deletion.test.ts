import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_PREFIX } from "../shared/origin-workspaces.ts";
import { soulFile } from "./bot-folder.ts";
import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { ensureTeamChiefs, uniqueTeamName, workspaceHeads } from "./origin-teams.ts";
import { canAccessTeam } from "./peer-roster.ts";
import * as sectionContext from "./section-context.ts";
import { Store, type BotRecord } from "./store.ts";
import { TeamComputers } from "./team-computers.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "fixture" });
const createStore = (computers?: Pick<TeamComputers, "forSection">) =>
  new Store(selection, undefined, undefined, section => Boolean(computers?.forSection(section)));
const head = (store: Store, name: string) => {
  const bot = store.createBot({ name, section: WORKSPACE_PREFIX + name });
  store.setChiefOfStaff(bot.id);
  return bot;
};

describe("workspace head deletion", () => {
  beforeEach(() => { rmSync(DATA_DIR, { recursive: true, force: true }); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("removes only the deleted head's empty workspace section and publishes the section change", () => {
    const store = createStore();
    const primary = head(store, "Primary");
    const secondary = head(store, "Secondary");
    const project = store.createBot({ name: "Project", section: "Project" });
    store.setChiefOfStaff(project.id);
    store.patchBot(secondary.id, { managedSections: ["Project"] });
    sectionContext.writeSectionContext(secondary.section, "Synthetic workspace instructions");
    const projectBefore = structuredClone(project);
    const projectMessages = store.messagesFor(project.threadId);
    const changes: string[] = [];
    store.onChange(change => { changes.push(change.type); });

    expect(store.deleteBot(secondary.id)).toBe(true);

    expect(store.sections).not.toContain(secondary.section);
    expect(store.sections).toContain(primary.section);
    expect(store.sections).toContain("Project");
    expect(store.bot(primary.id)).toBe(primary);
    expect(store.bot(project.id)).toEqual(projectBefore);
    expect(store.messagesFor(project.threadId)).toEqual(projectMessages);
    expect(sectionContext.readSectionContext(secondary.section)).toBeNull();
    expect(changes).toContain("sections");
    const restored = new Store(selection);
    expect(restored.sections).not.toContain(secondary.section);
    expect(restored.bot(project.id)).toMatchObject(projectBefore);
  });

  it("does not reserve a numbered replacement or recreate the deleted head during startup", () => {
    const store = createStore();
    head(store, "Primary");
    const secondary = head(store, "Secondary");
    store.deleteBot(secondary.id);

    const restored = new Store(selection);
    expect(uniqueTeamName(restored, WORKSPACE_PREFIX + "Secondary")).toBe(WORKSPACE_PREFIX + "Secondary");
    expect(ensureTeamChiefs(restored, selection())).toEqual([]);
    expect(workspaceHeads(restored).map(bot => bot.name)).toEqual(["Primary"]);
  });

  it("does not promote an orphaned saved workspace section back into a head on restart", () => {
    const store = createStore();
    head(store, "Primary");
    const secondary = head(store, "Secondary");
    store.deleteBot(secondary.id);

    const restored = new Store(selection);
    expect(ensureTeamChiefs(restored, selection())).toEqual([]);
    expect(workspaceHeads(restored).map(bot => bot.name)).toEqual(["Primary"]);
  });

  it("revokes exact grants before a deleted workspace name can be reused, retaining live bot references", () => {
    const store = createStore();
    const primary = head(store, "Primary");
    const secondary = head(store, "Secondary");
    store.patchBot(primary.id, { managedSections: [secondary.section!, ` ${secondary.section} `, "Project", "Workspace: Secondary East"] });
    const retire = sectionContext.changeEmptySection;
    vi.spyOn(sectionContext, "changeEmptySection").mockImplementationOnce((name, nextName) => {
      const saved: BotRecord[] = JSON.parse(readFileSync(join(DATA_DIR, "bots.json"), "utf8"));
      expect(saved.find(candidate => candidate.id === primary.id)?.managedSections).toEqual(["Project", "Workspace: Secondary East"]);
      expect(saved.some(candidate => candidate.id === secondary.id)).toBe(false);
      retire(name, nextName);
    });
    store.deleteBot(secondary.id);

    expect(store.bot(primary.id)).toBe(primary);
    expect(primary.managedSections).toEqual(["Project", "Workspace: Secondary East"]);
    head(store, "Secondary");
    const restored = new Store(selection);
    expect(canAccessTeam(restored.bot(primary.id)!, secondary.section!)).toBe(false);
    expect(canAccessTeam(restored.bot(primary.id)!, "Project")).toBe(true);
  });

  it.each(["active", "hidden", "archived-thread"])("retains a workspace section with another %s bot and its instructions", (kind) => {
    const store = createStore();
    head(store, "Primary");
    const secondary = head(store, "Secondary");
    const retained = store.createBot({ name: "Keep my work", section: secondary.section });
    if (kind === "hidden") store.patchBot(retained.id, { hidden: true });
    if (kind === "archived-thread") store.patchTask(retained.id, retained.threadId, { archivedAt: 1 });
    sectionContext.writeSectionContext(secondary.section, "Keep these instructions");
    const before = structuredClone(retained);
    const messages = store.messagesFor(retained.threadId);

    store.deleteBot(secondary.id);

    expect(store.sections).toContain(secondary.section);
    expect(sectionContext.readSectionContext(secondary.section)?.text).toBe("Keep these instructions");
    expect(store.bot(retained.id)).toEqual(before);
    expect(store.messagesFor(retained.threadId)).toEqual(messages);
    expect(new Store(selection).bot(retained.id)).toMatchObject(before);
  });

  it("retains a workspace section owned by a group chat", () => {
    const store = createStore();
    const primary = head(store, "Primary");
    const secondary = head(store, "Secondary");
    const group = store.createGroup("Keep discussion", [primary.id], false, secondary.section);
    const before = structuredClone(group);
    store.deleteBot(secondary.id);

    expect(store.sections).toContain(secondary.section);
    expect(new Store(selection).groups.find(candidate => candidate.id === group.id)).toEqual(before);
  });

  it("retains the section, instructions and access grants for its shared team computer", () => {
    const computers = new TeamComputers(join(DATA_DIR, "team-computers.json"), "77f57581-4011-44de-970c-a360d5b4a508");
    const store = createStore(computers);
    const primary = head(store, "Primary");
    const secondary = head(store, "Secondary");
    store.patchBot(primary.id, { managedSections: [secondary.section!] });
    sectionContext.writeSectionContext(secondary.section, "Shared computer instructions");
    const computer = computers.create("Shared synthetic computer");
    computers.assign(computer.id, secondary.section!);

    expect(store.deleteBot(secondary.id)).toBe(true);

    expect(computers.forSection(secondary.section)?.id).toBe(computer.id);
    expect(store.sections).toContain(secondary.section);
    expect(primary.managedSections).toEqual([secondary.section]);
    expect(sectionContext.readSectionContext(secondary.section)?.text).toBe("Shared computer instructions");
  });

  it("fails closed before deleting the head when shared computer ownership cannot be checked", () => {
    const computers = { forSection: () => { throw new Error("Registry unavailable"); } };
    const store = createStore(computers);
    const secondary = head(store, "Secondary");
    expect(() => store.deleteBot(secondary.id)).toThrow("Registry unavailable");
    expect(new Store(selection).bot(secondary.id)?.name).toBe("Secondary");
    expect(store.sections).toContain(secondary.section);
    expect(existsSync(soulFile(secondary.id))).toBe(true);
  });

  it("retains the intended empty ordinary team when its last bot is deleted", () => {
    const store = createStore();
    head(store, "Primary");
    const bot = store.createBot({ name: "Project", section: "Project" });
    store.setChiefOfStaff(bot.id);
    sectionContext.writeSectionContext("Project", "Keep ordinary team instructions");
    store.deleteBot(bot.id);

    const restored = new Store(selection);
    expect(restored.sections).toContain("Project");
    expect(sectionContext.readSectionContext("Project")?.text).toBe("Keep ordinary team instructions");
  });

  it("does not remove a reserved section when the deleted bot was not its head", () => {
    const store = createStore();
    const bot = store.createBot({ name: "Member", section: WORKSPACE_PREFIX + "Secondary" });
    store.deleteBot(bot.id);
    expect(new Store(selection).sections).toContain(bot.section);
  });

  it("preserves the head, grants, instructions and transcript when bot persistence fails", () => {
    const store = createStore();
    const primary = head(store, "Primary");
    const secondary = head(store, "Secondary");
    store.patchBot(primary.id, { managedSections: [secondary.section!] });
    sectionContext.writeSectionContext(secondary.section, "Recoverable instructions");
    const messages = store.messagesFor(secondary.threadId);
    vi.spyOn(store as unknown as { saveBots(bots: BotRecord[]): void }, "saveBots")
      .mockImplementationOnce(() => { throw new Error("disk full"); });

    expect(() => store.deleteBot(secondary.id)).toThrow("disk full");
    expect(store.bot(secondary.id)).toBe(secondary);
    expect(primary.managedSections).toEqual([secondary.section]);
    expect(store.sections).toContain(secondary.section);
    expect(existsSync(soulFile(secondary.id))).toBe(true);
    expect(store.messagesFor(secondary.threadId)).toEqual(messages);
    expect(new Store(selection).bot(secondary.id)?.name).toBe("Secondary");
  });

  it("restores bot persistence before deleting any data when section cleanup fails", () => {
    const store = createStore();
    const primary = head(store, "Primary");
    const secondary = head(store, "Secondary");
    store.patchBot(primary.id, { managedSections: [secondary.section!] });
    const before = readFileSync(join(DATA_DIR, "bots.json"), "utf8");
    const messages = store.messagesFor(secondary.threadId);
    vi.spyOn(sectionContext, "changeEmptySection").mockImplementationOnce(() => { throw new Error("section unavailable"); });

    expect(() => store.deleteBot(secondary.id)).toThrow("section unavailable");
    expect(readFileSync(join(DATA_DIR, "bots.json"), "utf8")).toBe(before);
    expect(store.bot(secondary.id)).toBe(secondary);
    expect(primary.managedSections).toEqual([secondary.section]);
    expect(existsSync(soulFile(secondary.id))).toBe(true);
    expect(store.messagesFor(secondary.threadId)).toEqual(messages);
    expect(new Store(selection).bot(secondary.id)?.name).toBe("Secondary");
  });

  it("repairs an existing empty reserved section before startup can recreate its workspace head", () => {
    const store = createStore();
    const primary = head(store, "Primary");
    const ghost = WORKSPACE_PREFIX + "Already deleted";
    const project = store.createBot({ name: "Keep project", section: "Keep project" });
    store.setChiefOfStaff(project.id);
    store.setBotsSection([], ghost);
    store.patchBot(primary.id, { managedSections: [ghost, "Keep project"] });
    sectionContext.writeSectionContext(ghost, "Obsolete workspace instructions");
    const messages = store.messagesFor(project.threadId);

    expect(ensureTeamChiefs(store, selection())).toEqual([]);

    expect(store.sections).not.toContain(ghost);
    expect(sectionContext.readSectionContext(ghost)).toBeNull();
    expect(primary.managedSections).toEqual(["Keep project"]);
    expect(store.messagesFor(project.threadId)).toEqual(messages);
    expect(new Store(selection).sections).not.toContain(ghost);
    expect(workspaceHeads(store).map(bot => bot.name)).toEqual(["Primary"]);
  });

  it("preserves nonempty sections, shared computers and an already recreated head with its conversation during startup", () => {
    const computers = new TeamComputers(join(DATA_DIR, "team-computers.json"), "77f57581-4011-44de-970c-a360d5b4a508");
    const store = createStore(computers);
    const primary = head(store, "Primary");
    const recreated = head(store, "Already recreated");
    const hidden = store.createBot({ name: "Archived work", section: WORKSPACE_PREFIX + "Archived" });
    store.patchBot(hidden.id, { hidden: true });
    const room = store.createGroup("Retained discussion", [primary.id], false, WORKSPACE_PREFIX + "Discussion");
    const computer = computers.create("Retained shared computer");
    const computerSection = WORKSPACE_PREFIX + "Computer";
    store.setBotsSection([], computerSection);
    computers.assign(computer.id, computerSection);
    const messages = store.messagesFor(recreated.threadId);

    ensureTeamChiefs(store, selection());

    for (const section of [recreated.section, hidden.section, room.section, computerSection]) expect(store.sections).toContain(section);
    expect(store.bot(recreated.id)).toBe(recreated);
    expect(store.messagesFor(recreated.threadId)).toEqual(messages);
    expect(store.bot(hidden.id)?.hidden).toBe(true);
    expect(store.groups.find(group => group.id === room.id)).toBe(room);
    expect(computers.forSection(computerSection)?.id).toBe(computer.id);
  });

  it("retains a saved reserved section when shared computer occupancy is not configured", () => {
    const store = new Store(selection);
    const secondary = head(store, "Secondary");
    store.deleteBot(secondary.id);
    expect(store.sections).toContain(secondary.section);
  });

  it("does not free an existing ghost's name or create a replacement when startup grant persistence fails", () => {
    const store = createStore();
    const primary = head(store, "Primary");
    const ghost = WORKSPACE_PREFIX + "Already deleted";
    store.setBotsSection([], ghost);
    store.patchBot(primary.id, { managedSections: [ghost] });
    vi.spyOn(store as unknown as { saveBots(bots: BotRecord[]): void }, "saveBots")
      .mockImplementationOnce(() => { throw new Error("disk full"); });

    expect(() => ensureTeamChiefs(store, selection())).toThrow("disk full");
    expect(store.bots).toEqual([primary]);
    expect(store.sections).toContain(ghost);
    expect(primary.managedSections).toEqual([ghost]);
    expect(new Store(selection).sections).toContain(ghost);
  });
});
