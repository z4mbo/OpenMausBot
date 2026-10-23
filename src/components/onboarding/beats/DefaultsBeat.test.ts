import { createElement, type EffectCallback } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { SharedAgentPlan } from "@/lib/shared-agents-plan";
import type { InstanceInfo } from "@/state/store";

const fixture = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as EffectCallback[] }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? initial() : initial;
    return [fixture.values[index], (next: unknown) => {
      fixture.values[index] = typeof next === "function" ? next(fixture.values[index]) : next;
    }];
  },
  useEffect: (effect: EffectCallback) => {
    fixture.effects.push(effect);
  },
}));
const store = vi.hoisted(() => ({ instances: [] as unknown[], api: vi.fn() }));
vi.mock("@/state/store", () => ({ api: store.api, ApiError: class extends Error {}, useStore: () => ({ state: { instances: store.instances }, dispatch: vi.fn() }) }));
vi.mock("@/components/ProviderIcons", () => ({ InstanceProviderMark: () => null }));
vi.mock("@/components/ApiKeys", () => ({
  ApiKeyRow: ({ section }: { section: string }) => createElement("div", null, `key:${section}`),
  VpsConnection: () => createElement("div", null, "vps"),
}));
import { ComputersBeat } from "./ComputersBeat";
import { DefaultsBeat } from "./DefaultsBeat";
import { oneClickInstall } from "./EnginesBeat";
import { ProjectsBeat } from "./ProjectsBeat";

const ready = (instanceId: string, driverKind: string, models: string[]): InstanceInfo => ({
  instanceId, driverKind, displayName: instanceId,
  snapshot: { state: "available", authenticated: true },
  models: { default: models[0] ?? "", options: models.map((id) => ({ id, label: id })) },
});
const props = { onNext: vi.fn(), onSkip: vi.fn(), setMascot: vi.fn(), bump: vi.fn(), onSetUpModels: vi.fn() };

function render(plan: SharedAgentPlan | null = null) {
  fixture.values = [plan];
  fixture.index = 0;
  fixture.effects = [];
  return renderToStaticMarkup(createElement(() => DefaultsBeat(props)));
}

beforeEach(() => {
  store.instances = [];
  store.api.mockReset();
  setLocale("en");
});

describe("DefaultsBeat", () => {
  it("points back to the engines when nothing is ready, and cannot be finished", () => {
    const html = render();
    expect(html).toContain("Set up a model");
    expect(html).toMatch(/<button data-primary="" disabled=""/);
  });

  it("offers a picker per ready provider from local engines alone when there is no plan", () => {
    store.instances = [ready("claude", "claudeAgent", ["opus", "sonnet"]), ready("codex", "codex", ["gpt-5"])];
    const html = render();
    expect(html).toContain("Default model for Anthropic");
    expect(html).toContain("Default model for OpenAI");
    expect(html).not.toContain(">Shared bots<");
  });

  it("holds the pickers until the plan they save into has arrived", () => {
    store.instances = [ready("claude", "claudeAgent", ["opus", "sonnet"])];
    expect(render()).toMatch(/<select[^>]*disabled=""[^>]*aria-label="Default model for Anthropic"|<select[^>]*aria-label="Default model for Anthropic"[^>]*disabled=""/);
    expect(render({ defaults: {}, bots: [] } as unknown as SharedAgentPlan)).not.toMatch(/<select[^>]*disabled=""/);
  });

  it("asks the server for the plan", async () => {
    store.api.mockResolvedValue({ defaults: {}, bots: [] });
    render();
    fixture.effects[0]!();
    expect(store.api).toHaveBeenCalledWith("/api/origin/shared-agents/plan", expect.anything());
  });

  it("shows what each shared bot runs on, and a way to set up a model when nothing fits", () => {
    store.instances = [ready("claude", "claudeAgent", ["opus"])];
    const html = render({
      defaults: { claudeAgent: { instanceId: "claude", model: "opus" } },
      bots: [
        { botId: "a", name: "Scout", intent: { provider: "claudeAgent", model: "opus" }, resolved: { instanceId: "claude", model: "opus", label: "Claude · Opus" }, via: "intent" },
        { botId: "b", name: "Writer", intent: { provider: "codex", model: "gpt-5" }, resolved: { instanceId: "claude", model: "opus", label: "Claude · Opus" }, via: "fallback" },
        { botId: "c", name: "Idle", intent: null, resolved: null, via: "none" },
      ],
    });
    expect(html).toContain(">Shared bots<");
    expect(html).toContain("Requested");
    expect(html).toContain("Fallback");
    expect(html).toContain("Asks for gpt-5");
    expect(html).toContain("Set up a model");
  });
});

describe("ComputersBeat", () => {
  it("embeds the Boat key and SSH settings and can be skipped", () => {
    fixture.index = 0;
    const html = renderToStaticMarkup(createElement(() => ComputersBeat(props)));
    expect(html).toContain("key:box");
    expect(html).toContain("vps");
    expect(html).toContain("Skip for now");
  });
});

describe("oneClickInstall", () => {
  const missing = (install: InstanceInfo["install"]): InstanceInfo => ({
    instanceId: "x", driverKind: "codex", displayName: "Codex", install,
    snapshot: { state: "unavailable" }, models: { default: "", options: [] },
  });

  it("offers Install only for a missing engine the app can install itself", () => {
    expect(oneClickInstall(missing({ server: { package: "@openai/codex" } }))).toBe(true);
    expect(oneClickInstall(missing({ managed: { label: "Install", downloadBytes: 1 } }))).toBe(true);
    expect(oneClickInstall(missing({ command: { linux: "curl -fsSL https://example.test | sh" } }))).toBe(false);
    expect(oneClickInstall({ ...ready("codex", "codex", ["gpt-5"]), install: { server: { package: "@openai/codex" } } })).toBe(false);
  });
});

describe("ProjectsBeat", () => {
  const renderProjects = (answer: unknown, selected: string | null) => {
    vi.stubGlobal("window", {});
    fixture.values = [answer, selected];
    fixture.index = 0;
    fixture.effects = [];
    try {
      return renderToStaticMarkup(createElement(() => ProjectsBeat(props)));
    } finally {
      vi.unstubAllGlobals();
    }
  };

  it("offers Documents and Desktop with Documents picked, and Continue ready", () => {
    const documents = "/home/me/Documents/Origin";
    const html = renderProjects({
      root: documents,
      chosen: false,
      suggestions: [{ label: "Documents", path: documents }, { label: "Desktop", path: "/home/me/Desktop/Origin" }],
    }, documents);
    expect(html).toMatch(/aria-checked="true"[^>]*>.*Documents/);
    expect(html).toContain("Desktop");
    expect(html).not.toMatch(/<button data-primary="" disabled=""/);
  });

  it("still shows the default and lets Continue work before the server answers", () => {
    const html = renderProjects(null, null);
    expect(html).toContain("Documents › Origin");
    expect(html).not.toMatch(/<button data-primary="" disabled=""/);
  });
});
