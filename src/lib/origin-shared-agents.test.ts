import { describe, expect, it } from "vitest";
import { definitionHash, definitionOf } from "../../shared/origin-shared-agents";
import { adoptionPairs, reconcile, roleKeys, syncSharedAgents, type CloudAgent, type LocalBot } from "./origin-shared-agents";

const agent = (fields: Partial<CloudAgent>): CloudAgent => ({
  _id: "a1", teamId: "team", projectId: "p1", kind: "agent", name: "Dana", title: "Designer", description: "", soul: "Design.", soulVersion: 1,
  color: "green", canEdit: false, ...fields,
});

describe("shared agent adoption", () => {
  it("gives a team unique role keys and pairs by role first, then by name", () => {
    const team: LocalBot[] = [
      { id: "chief", name: "App", chiefOfStaff: true }, { id: "d1", name: "Dana", title: "Designer" }, { id: "d2", name: "Dee", title: "Designer" }, { id: "w", name: "Wren" },
    ];
    const keys = roleKeys(team);
    expect([...keys.values()]).toEqual(["chief", "designer", "designer-2", "wren"]);
    const cloud = [agent({ _id: "c", kind: "chief", roleKey: "chief", name: "App" }), agent({ _id: "x", roleKey: "designer-2", name: "Dee" }), agent({ _id: "y", roleKey: "writer", name: "wren" })];
    expect(adoptionPairs(team, cloud, keys).map(([bot, cloudAgent]) => [bot.id, cloudAgent._id])).toEqual([["chief", "c"], ["d2", "x"], ["w", "y"]]);
  });

  it("pulls a newer cloud version, asks for review when someone else changed the instructions, and pushes local edits only with edit rights", () => {
    const local = definitionOf({ name: "Dana", title: "Designer", soul: "Design." });
    const meta = { version: 1, hash: definitionHash(local) };
    expect(reconcile(meta, local, agent({}), "me")).toEqual({ action: "none" });
    expect(reconcile(meta, local, agent({ soulVersion: 2, title: "Lead designer", updatedBy: "other" }), "me")).toEqual({ action: "pull", review: false });
    expect(reconcile(meta, local, agent({ soulVersion: 2, soul: "Do something else.", updatedBy: "other" }), "me")).toEqual({ action: "pull", review: true });
    expect(reconcile(meta, local, agent({ soulVersion: 2, soul: "Mine.", updatedBy: "me" }), "me")).toEqual({ action: "pull", review: false });
    const edited = { ...local, soul: "Design better." };
    expect(reconcile(meta, edited, agent({}), "me")).toEqual({ action: "none" });
    expect(reconcile(meta, edited, agent({ canEdit: true }), "me")).toEqual({ action: "push" });
  });
});

describe("shared agent sync round", () => {
  it("publishes the first member's team, then a second member adopts it and creates the missing bot", async () => {
    const published: unknown[] = [];
    const cloudAgents: CloudAgent[] = [];
    const cloud = {
      async query<T>(name: string): Promise<T> {
        if (name === "agents:teamSettings") return { sharedAgents: true, userId: "me" } as T;
        if (name === "agents:listForTeam") return cloudAgents as T;
        return [] as T;
      },
      async mutation<T>(name: string, args: Record<string, unknown>): Promise<T> {
        if (name !== "agents:publishProjectTeam") throw new Error(name);
        published.push(args);
        const rows = (args.agents as { roleKey: string; kind: CloudAgent["kind"]; name: string }[]).map((row, index) => {
          cloudAgents.push(agent({ _id: `c${index}`, roleKey: row.roleKey, kind: row.kind, name: row.name, canEdit: true }));
          return { roleKey: row.roleKey, agentId: `c${index}`, created: true };
        });
        return rows as T;
      },
    };
    const calls: Array<[string, string | undefined]> = [];
    const call = async <T,>(path: string, init?: { method?: string; body?: string }): Promise<T> => {
      calls.push([path, init?.method]);
      if (path === "/api/origin/shared-agents") return { bots: {} } as T;
      if (path === "/api/bots") return { bot: { id: "new", name: "Dana", section: "App" } } as T;
      return {} as T;
    };
    const first = await syncSharedAgents({
      cloud, call, looks: {}, driverKindOf: () => "claudeAgent", links: { workspaces: {}, projects: { chief: "p1" } },
      bots: [{ id: "chief", name: "App", chiefOfStaff: true, section: "App", modelSelection: { instanceId: "i", model: "claude-haiku-5-5" } }, { id: "dana", name: "Dana", title: "Designer", section: "App" }],
    }, [{ _id: "p1", teamId: "team" }]);
    expect(first.published).toBe(2);
    expect((published[0] as { agents: { modelIntent?: unknown }[] }).agents[0].modelIntent).toEqual({ provider: "claudeAgent", model: "claude-haiku-5-5" });
    expect(calls.filter(([path]) => path === "/api/origin/shared-agents/bind")).toHaveLength(2);

    calls.length = 0;
    const second = await syncSharedAgents({
      cloud, call, looks: {}, driverKindOf: () => undefined, links: { workspaces: {}, projects: { mychief: "p1" } },
      bots: [{ id: "mychief", name: "App", chiefOfStaff: true, section: "App" }],
    }, [{ _id: "p1", teamId: "team" }]);
    expect(second).toMatchObject({ published: 0, adopted: 1, created: 1 });
    expect(calls.map(([path]) => path)).toContain("/api/origin/shared-agents/snapshot");
    expect(calls.map(([path]) => path)).toContain("/api/bots");
    expect(published).toHaveLength(1);
  });
});

describe("sharing withdrawn", () => {
  it("unbinds local bots, never deleting them, when the team stops sharing or the agent is gone, then adopts a live one", async () => {
    const binds: unknown[] = [];
    const call = async <T,>(path: string, init?: { method?: string; body?: string }): Promise<T> => {
      if (path === "/api/origin/shared-agents/bind") binds.push(JSON.parse(init!.body!));
      if (path === "/api/bots") throw new Error("must not create");
      return (path === "/api/origin/shared-agents" ? { bots: {} } : {}) as T;
    };
    const run = (sharedAgents: boolean, agents: CloudAgent[]) => syncSharedAgents({
      cloud: {
        async query<T>(name: string): Promise<T> { return (name === "agents:teamSettings" ? { sharedAgents, userId: "me" } : name === "agents:listForTeam" ? agents : []) as T; },
        async mutation<T>(): Promise<T> { throw new Error("must not publish"); },
      },
      call, looks: {}, driverKindOf: () => undefined,
      links: { workspaces: {}, projects: { chief: "p1" }, agents: { chief: "gone" } },
      bots: [{ id: "chief", name: "App", chiefOfStaff: true, section: "App" }],
    }, [{ _id: "p1", teamId: "team" }]);
    expect((await run(false, [])).unbound).toBe(1);
    expect((await run(true, [agent({ _id: "other", kind: "chief", roleKey: "chief", name: "App" })])).unbound).toBe(1);
    expect(binds.slice(0, 2)).toEqual([{ botId: "chief", agentId: null }, { botId: "chief", agentId: null }]);
    expect(binds[2]).toMatchObject({ botId: "chief", agentId: "other" });
  });
});
