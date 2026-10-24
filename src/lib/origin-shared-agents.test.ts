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
  it("clears stale mascot overrides when a newer canonical profile returns to the default appearance", async () => {
    const bot: LocalBot = { id: "chief", name: "Origin", title: "", soul: "", color: "green", chiefOfStaff: true, section: "Origin", mascotExpression: "sleeping", mascotBody: "star" };
    const look = { look: "dot" as const, color: "#112233" };
    const patches: Record<string, unknown>[] = [];
    const meta = { version: 1, hash: definitionHash(definitionOf(bot, look)) };
    const canonical = agent({ _id: "shared-chief", kind: "chief", roleKey: "chief", name: "Origin", title: "", soul: "", soulVersion: 2, canEdit: true });
    const call = async <T,>(path: string, init?: { body?: string }): Promise<T> => {
      const patch = init?.body ? JSON.parse(init.body) : {};
      if (path === "/api/origin/shared-agents") return { bots: { chief: meta } } as T;
      if (path === "/api/bots/chief") { patches.push(patch); return { bot: { ...bot, ...patch } } as T; }
      return {} as T;
    };
    await syncSharedAgents({
      cloud: { async query<T>(name: string): Promise<T> { return (name === "agents:teamSettings" ? { sharedAgents: true, userId: "me" } : name === "agents:listForTeam" ? [canonical] : []) as T; }, async mutation<T>(): Promise<T> { throw new Error("A canonical pull must not write cloud data"); } },
      call, bots: [bot], looks: { chief: look }, links: { workspaces: {}, projects: { chief: "p1" }, agents: { chief: canonical._id } }, driverKindOf: () => undefined,
    }, [{ _id: "p1", teamId: "team" }]);
    expect(patches[0]).toMatchObject({ mascotExpression: null, mascotBody: "cursor" });
  });

  it("publishes explicit appearance resets instead of omitting cleared local choices", async () => {
    const before: LocalBot = { id: "chief", name: "Origin", title: "", soul: "", color: "green", chiefOfStaff: true, section: "Origin", mascotExpression: "sleeping", mascotBody: "star" };
    const bot = { ...before, mascotExpression: null, mascotBody: "cursor" };
    const look = { look: "dot" as const, color: "#112233" };
    const meta = { version: 1, hash: definitionHash(definitionOf(before, look)) };
    const canonical = agent({ _id: "shared-chief", kind: "chief", roleKey: "chief", name: "Origin", title: "", soul: "", soulVersion: 1, canEdit: true, mascotExpression: "sleeping", mascotBody: "star", look });
    const updates: Record<string, unknown>[] = [];
    await syncSharedAgents({
      cloud: { async query<T>(name: string): Promise<T> { return (name === "agents:teamSettings" ? { sharedAgents: true, userId: "me" } : name === "agents:listForTeam" ? [canonical] : []) as T; }, async mutation<T>(_name: string, args: Record<string, unknown>): Promise<T> { updates.push(args); return { soulVersion: 2 } as T; } },
      async call<T>(path: string): Promise<T> { return (path === "/api/origin/shared-agents" ? { bots: { chief: meta } } : {}) as T; },
      bots: [bot], looks: {}, links: { workspaces: {}, projects: { chief: "p1" }, agents: { chief: canonical._id } }, driverKindOf: () => undefined,
    }, [{ _id: "p1", teamId: "team" }]);
    expect(updates[0].patch).toMatchObject({ mascotExpression: "", mascotBody: "cursor", look: { look: "mascot" } });
  });

  it("keeps canonical head names and appearances when a second independent machine adopts the same six-role team", async () => {
    const canonical: CloudAgent[] = [];
    const updates: Record<string, unknown>[] = [];
    const roles = ["Researcher", "Product Manager", "Designer", "Developer", "Marketer", "Copywriter"];
    const cloud = {
      async query<T>(name: string): Promise<T> {
        return structuredClone(name === "agents:teamSettings" ? { sharedAgents: true, userId: "owner" } : name === "agents:listForTeam" ? canonical : []) as T;
      },
      async mutation<T>(name: string, args: Record<string, unknown>): Promise<T> {
        if (name === "agents:publishProjectTeam") return (args.agents as Array<Record<string, unknown>>).map(profile => {
          const id = `${args.projectId ?? "workspace"}-${profile.roleKey}`;
          canonical.push(agent({ ...profile, _id: id, teamId: String(args.teamId), projectId: args.projectId as string | undefined, soulVersion: 1, canEdit: true }));
          return { roleKey: profile.roleKey, agentId: id, created: true };
        }) as T;
        if (name === "agents:update") {
          updates.push(args);
          const row = canonical.find(value => value._id === args.agentId)!;
          Object.assign(row, args.patch, { soulVersion: row.soulVersion + 1 });
          return { soulVersion: row.soulVersion } as T;
        }
        throw new Error(`Unexpected cloud mutation: ${name}`);
      },
    };
    function machine(prefix: string, headName: string, look: { look: "mascot" | "dot"; color: string; face?: string }) {
      const bots = new Map<string, LocalBot>([
        [`${prefix}-head`, { id: `${prefix}-head`, name: headName, chiefOfStaff: true, section: "Workspace: GGs" }],
        [`${prefix}-chief`, { id: `${prefix}-chief`, name: "Origin", chiefOfStaff: true, section: "Origin" }],
        ...roles.map((name, index): [string, LocalBot] => [`${prefix}-${index}`, { id: `${prefix}-${index}`, name, title: name, section: "Origin" }]),
      ]);
      const looks: Record<string, { look?: "mascot" | "dot"; color?: string; face?: string }> = { [`${prefix}-head`]: look };
      const meta: Record<string, { version: number; hash: string }> = {};
      const links = { workspaces: { [`${prefix}-head`]: "team" }, projects: { [`${prefix}-chief`]: "p1" }, agents: {} as Record<string, string> };
      const call = async <T,>(path: string, init?: { method?: string; body?: string }): Promise<T> => {
        const body = init?.body ? JSON.parse(init.body) : {};
        if (path === "/api/origin/shared-agents") return structuredClone({ bots: meta }) as T;
        if (path === "/api/origin/shared-agents/bind") { links.agents[body.botId] = body.agentId; meta[body.botId] = { version: body.version, hash: body.hash }; return {} as T; }
        if (path === "/api/origin/shared-agents/meta") { Object.assign(meta[body.botId], body); return {} as T; }
        if (path === "/api/origin/shared-agents/snapshot") return {} as T;
        const match = /^\/api\/bots\/([^/]+)(\/avatar-look)?$/.exec(path);
        if (match) {
          const id = decodeURIComponent(match[1]);
          if (match[2]) { looks[id] = Object.fromEntries(Object.entries(body).filter(([, value]) => value !== null)); return {} as T; }
          const bot = { ...bots.get(id)!, ...body }; bots.set(id, bot); return structuredClone({ bot }) as T;
        }
        throw new Error(`Unexpected local path: ${path}`);
      };
      return { bots, looks, run: () => syncSharedAgents({ cloud, call, looks: structuredClone(looks), driverKindOf: () => undefined, links: structuredClone(links), bots: structuredClone([...bots.values()]) }, [{ _id: "p1", teamId: "team" }]) };
    }
    const windows = machine("win", "Django", { look: "dot", color: "#112233", face: "#ABCDEF" });
    await windows.run();
    const mac = machine("mac", "GGs", { look: "mascot", color: "#FFFFFF" });
    await mac.run();
    expect(mac.bots.get("mac-head")?.name).toBe("Django");
    expect(mac.bots.get("mac-head")?.section).toBe("Workspace: GGs");
    expect(mac.looks["mac-head"]).toEqual(windows.looks["win-head"]);
    expect([...mac.bots.values()].filter(bot => !bot.chiefOfStaff).map(bot => bot.name)).toEqual(roles);
    expect(canonical.find(value => value.kind === "head")?.name).toBe("Django");
    expect(updates).toEqual([]);
    await mac.run();
    await windows.run();
    expect(canonical.find(value => value.kind === "head")?.name).toBe("Django");
    expect(updates).toEqual([]);
  });

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

describe("one team failing", () => {
  it("still brings in another workspace's project agents, and leaves links to teams outside the account alone", async () => {
    const asked: string[] = [];
    const created: unknown[] = [];
    const cloud = {
      async query<T>(name: string, args: Record<string, unknown>): Promise<T> {
        asked.push(`${name}:${String(args.teamId)}`);
        if (args.teamId === "team-a") throw new Error("No active team access");
        if (name === "agents:teamSettings") return { sharedAgents: true, userId: "me" } as T;
        if (name === "agents:listForTeam") return [agent({ _id: "head-b-cloud", teamId: "team-b", projectId: undefined, kind: "head", roleKey: "head", name: "Shop" }), agent({ _id: "chief-b", teamId: "team-b", projectId: "p-b", kind: "chief", roleKey: "chief", name: "Bakery" }), agent({ _id: "dana-b", teamId: "team-b", projectId: "p-b", roleKey: "designer" })] as T;
        return [] as T;
      },
      async mutation<T>(): Promise<T> { throw new Error("must not publish"); },
    };
    const call = async <T,>(path: string, init?: { body?: string }): Promise<T> => {
      if (path === "/api/origin/shared-agents") return { bots: {} } as T;
      if (path === "/api/bots") { created.push(JSON.parse(init!.body!)); return { bot: { id: "dana-local", name: "Dana", section: "Bakery" } } as T; }
      return {} as T;
    };
    const result = await syncSharedAgents({
      cloud, call, looks: {}, driverKindOf: () => undefined,
      links: { workspaces: { "head-a": "team-a", "head-b": "team-b", "head-old": "team-old" }, projects: { "chief-local": "p-b" }, agents: {} },
      bots: [
        { id: "head-a", name: "Studio", chiefOfStaff: true, section: "Workspace: Studio" },
        { id: "head-b", name: "Shop", chiefOfStaff: true, section: "Workspace: Shop" },
        { id: "head-old", name: "Old", chiefOfStaff: true, section: "Workspace: Old" },
        { id: "chief-local", name: "Bakery", chiefOfStaff: true, section: "Bakery" },
      ],
    }, [{ _id: "p-b", teamId: "team-b" }], ["team-a", "team-b"]);
    expect(result.failures).toEqual([{ teamId: "team-a", error: "No active team access" }]);
    expect(created).toEqual([expect.objectContaining({ name: "Dana", section: "Bakery" })]);
    expect(result).toMatchObject({ created: 1 });
    expect(asked.some((entry) => entry.endsWith(":team-old"))).toBe(false);
  });
});
