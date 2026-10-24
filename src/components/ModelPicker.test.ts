import { Children, createElement, type ChangeEvent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppState, Bot, InstanceInfo } from "@/state/store";
import type { EffortLevel } from "../../shared/wire";
import { Select } from "./Select";

// The store module touches window and localStorage at import time, so it is stubbed to render under the node
// environment.
const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { instances: [] as InstanceInfo[], modelVariantSessions: {} as AppState["modelVariantSessions"], dispatch: vi.fn() };
});
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({
    state: { instances: fixture.instances, bots: [], modelVariantSessions: fixture.modelVariantSessions },
    dispatch: fixture.dispatch,
    refreshInstances: vi.fn(),
    refreshModels: vi.fn(),
  }),
}));

// These cases cover the full picker; Simple mode has its own file.
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));

const { ClaudeAccountSelect, EffortRow, ModelPicker, ModelVariantRow, modelSelectionForPick } = await import("./ModelPicker");
const { ModelPickerList } = await import("./ModelPickerList");
const { groupModels, pickerGroups } = await import("./model-picker-groups");

afterAll(() => vi.unstubAllGlobals());

function engine(effortLevels?: readonly EffortLevel[]): InstanceInfo {
  return {
    instanceId: "codex",
    driverKind: "codex",
    displayName: "Codex",
    snapshot: { state: "available", version: "1.0.0" },
    models: { default: "gpt-5.6", options: [{ id: "gpt-5.6", label: "GPT-5.6" }] },
    ...(effortLevels ? { capabilities: { effortLevels } } : {}),
  };
}

function bot(effort?: EffortLevel): Bot {
  return {
    id: "atlas",
    threadId: "thread-atlas",
    name: "Atlas",
    title: "",
    description: "",
    notifications: true,
    color: "green",
    unread: false,
    modelSelection: { instanceId: "codex", model: "gpt-5.6", ...(effort ? { effort } : {}) },
    messages: [],
  };
}

function levelButtons(markup: string): Array<{ label: string; pressed: boolean }> {
  return [...markup.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([^<]+)</g)].map((match) => ({
    label: match[2],
    pressed: match[1] === "true",
  }));
}

function renderEffort(instances: InstanceInfo[], effort?: EffortLevel): string {
  fixture.instances = instances;
  return renderToStaticMarkup(createElement(EffortRow, { bot: bot(effort) }));
}

describe("EffortRow", () => {
  it("uses a compact dropdown without changing scope or conflating None with Default", () => {
    fixture.instances = [engine(["none", "low", "high"])];
    const row = EffortRow({ bot: bot("high"), threadId: "independent-thread", updateBotDefault: true, compact: true })!;
    const select = Children.toArray(row.props.children).at(-1) as ReactElement<{ value: string; onChange: (event: ChangeEvent<HTMLSelectElement>) => void }>;
    expect(select.type).toBe(Select);
    expect(select.props.value).toBe("high");
    for (const value of ["none", ""]) {
      select.props.onChange({ target: { value } } as ChangeEvent<HTMLSelectElement>);
      expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: "independent-thread", updateBotDefault: true,
        selection: { instanceId: "codex", model: "gpt-5.6", effort: value || undefined } });
    }
    const markup = renderToStaticMarkup(createElement(EffortRow, { bot: bot(), compact: true }));
    expect(markup).toContain('aria-label="Reasoning effort"');
    expect(markup).not.toContain("<button");
    expect([...markup.matchAll(/<option[^>]*>([^<]+)</g)].map((match) => match[1])).toEqual(["Default", "None", "Low", "High"]);
  });
  it("can apply effort to the pinned thread and bot default together", () => {
    fixture.instances = [engine(["high"])];
    const row = EffortRow({ bot: bot(), threadId: "thread-atlas", updateBotDefault: true })!;
    const levels = Children.toArray(row.props.children).at(-1) as ReactElement<{ children: ReactNode }>;
    const high = Children.toArray(levels.props.children)[1] as ReactElement<{ onClick: () => void }>;
    high.props.onClick();
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: "thread-atlas", updateBotDefault: true, selection: { instanceId: "codex", model: "gpt-5.6", effort: "high" } });
  });
  it("pins thread effort changes without changing profile defaults", () => {
    fixture.instances = [engine(["high"])];
    const row = EffortRow({ bot: bot(), threadId: "independent-thread" })!;
    const levels = Children.toArray(row.props.children).at(-1) as ReactElement<{ children: ReactNode }>;
    const high = Children.toArray(levels.props.children)[1] as ReactElement<{ onClick: () => void }>;
    high.props.onClick();
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: "independent-thread", selection: { instanceId: "codex", model: "gpt-5.6", effort: "high" } });
  });
  it("renders nothing for an engine that declares no effort levels", () => {
    expect(renderEffort([engine()])).toBe("");
    expect(renderEffort([engine([])])).toBe("");
    expect(renderEffort([])).toBe("");
  });

  it("offers only the levels the selected engine accepts, plus Default", () => {
    const markup = renderEffort([engine(["low", "medium", "high"])]);

    expect(levelButtons(markup).map((button) => button.label)).toEqual(["Default", "Low", "Medium", "High"]);
    expect(markup).not.toContain(">X-High<");
    expect(markup).not.toContain(">Max<");
  });

  it("keeps Default and None apart — Default sends no level, None sends one", () => {
    const markup = renderEffort([engine(["none", "low"])]);

    expect(levelButtons(markup).map((button) => button.label)).toEqual(["Default", "None", "Low"]);
  });

  it("marks the active level, and Default when the bot carries no level", () => {
    const pressed = (markup: string) => levelButtons(markup).find((button) => button.pressed)?.label;

    expect(pressed(renderEffort([engine(["low", "high"])], "high"))).toBe("High");
    expect(pressed(renderEffort([engine(["low", "high"])]))).toBe("Default");
  });

  it("renames xhigh, the one level that does not capitalize cleanly", () => {
    expect(renderEffort([engine(["xhigh"])])).toContain(">X-High<");
  });
});


describe("OpenCode model variants", () => {
  const variants = [
    { id: "none", label: "None" }, { id: "minimal", label: "Minimal" },
    { id: "default", label: "Default" }, { id: "deep/custom", label: "Deep custom" },
  ];
  const opencode = (): InstanceInfo => ({ ...engine(), instanceId: "opencode", driverKind: "opencodeGo",
    capabilities: { modelVariants: true }, models: { default: "provider/model", options: [{ id: "provider/model", label: "Model", variants }] } });
  const selected = (variant?: string): Bot => ({ ...bot(), modelSelection: { instanceId: "opencode", model: "provider/model", ...(variant !== undefined ? { variant } : {}) } });
  beforeEach(() => { fixture.instances = [opencode()]; fixture.modelVariantSessions = {}; fixture.dispatch.mockClear(); });
  const render = (variant?: string) => renderToStaticMarkup(createElement(ModelVariantRow, { bot: selected(variant), threadId: "thread-atlas" }));

  it("keeps opaque variant ids and omission distinct in the compact dropdown", () => {
    const row = ModelVariantRow({ bot: selected("default"), threadId: "thread-atlas", compact: true })!;
    const label = Children.toArray(row.props.children)[0] as ReactElement<{ children: ReactNode }>;
    const select = Children.toArray(label.props.children).at(-1) as ReactElement<{ value: string; onChange: (event: ChangeEvent<HTMLSelectElement>) => void }>;
    expect(select.props.value).toBe("2");
    for (const [value, variant] of [["3", "deep/custom"], ["unset", undefined]]) {
      select.props.onChange({ target: { value } } as ChangeEvent<HTMLSelectElement>);
      expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: "thread-atlas",
        selection: { instanceId: "opencode", model: "provider/model", ...(variant !== undefined ? { variant } : {}) } });
    }
    const markup = renderToStaticMarkup(createElement(ModelVariantRow, { bot: { ...selected("removed"), busy: true }, compact: true }));
    expect(markup).toContain('disabled=""');
    expect(markup).toContain("removed (unverified)");
    expect(markup).toContain("Use session setting");
  });

  it("offers exact advertised ids without assuming that omission means none or default", () => {
    const markup = render();
    expect(levelButtons(markup)).toEqual([
      { label: "None", pressed: false }, { label: "Minimal", pressed: false },
      { label: "OpenCode default", pressed: false }, { label: "Deep custom", pressed: false },
    ]);
    expect(markup).toContain("No variant selected.");
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(levelButtons(render("none")).find((button) => button.pressed)?.label).toBe("None");
  });

  it.each(variants)("persists $id only to the pinned conversation and clears legacy effort", (option) => {
    const configured = selected();
    configured.modelSelection.effort = "high";
    const row = ModelVariantRow({ bot: configured, threadId: "independent-thread" })!;
    const group = Children.toArray(row.props.children).at(-1) as ReactElement<{ children: ReactNode }>;
    const button = Children.toArray(group.props.children)[variants.findIndex((candidate) => candidate.id === option.id)] as ReactElement<{ onClick: () => void }>;
    button.props.onClick();
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: "independent-thread",
      selection: { instanceId: "opencode", model: "provider/model", variant: option.id } });
  });

  it.each(["none", "default", "minimal", "removed"])("can clear %s to omission without asking for a default or none", (variant) => {
    const row = ModelVariantRow({ bot: selected(variant), threadId: "thread-atlas" })!;
    const clear = Children.toArray(row.props.children).find((child) =>
      typeof child === "object" && "type" in child && child.type === "button") as ReactElement<{ onClick: () => void; title: string }>;
    expect(clear.props.title).toContain("keeps its session or configured setting");
    clear.props.onClick();
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: "thread-atlas",
      selection: { instanceId: "opencode", model: "provider/model" } });
  });

  it("uses matching session choices, including an empty list, without changing the instance catalog", () => {
    fixture.modelVariantSessions["thread-atlas"] = { instanceId: "opencode", model: "provider/model", turnId: "turn", startedAt: "2026-09-15T00:00:00Z", acceptingUpdates: false,
      variants: { options: [{ id: "minimal", label: "Session minimal" }], currentValue: "minimal" } };
    expect(levelButtons(render()).map((button) => button.label)).toEqual(["Session minimal"]);
    expect(render()).toContain("No variant selected. Session: Session minimal.");
    expect(levelButtons(render()).some((button) => button.pressed)).toBe(false);
    expect(fixture.instances[0].models.options[0].variants).toEqual(variants);
    fixture.modelVariantSessions["thread-atlas"].variants = { options: [] };
    expect(render()).toBe("");
    expect(render("none")).toContain("is unavailable");
    expect(render("none")).not.toContain('aria-label="Reasoning variant"');
  });

  it("ignores another conversation, account, or model's session choices and preserves unavailable saved ids", () => {
    const session = { instanceId: "opencode", model: "provider/model", turnId: "turn", startedAt: "2026-09-15T00:00:00Z", acceptingUpdates: false, variants: { options: [] } };
    fixture.modelVariantSessions["other-thread"] = session;
    expect(levelButtons(render())).toHaveLength(4);
    fixture.modelVariantSessions["thread-atlas"] = { ...session, instanceId: "other-account" };
    expect(levelButtons(render())).toHaveLength(4);
    fixture.modelVariantSessions["thread-atlas"] = { ...session, model: "other-model" };
    expect(levelButtons(render())).toHaveLength(4);
    expect(render("removed")).toContain("Saved variant “removed” has not been checked in this session.");
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("does not invent default or expose a control on a model without variants", () => {
    fixture.instances[0].models.options[0].variants = [{ id: "minimal", label: "Minimal" }];
    expect(levelButtons(render()).map((button) => button.label)).toEqual(["Minimal"]);
    fixture.instances[0].models.options[0].variants = [];
    expect(render()).toBe("");
    fixture.instances[0].capabilities = {};
    expect(render("none")).toBe("");
  });

  it("does not declare a saved default invalid on reload before ACP announces its choices", () => {
    fixture.instances[0].models.options[0].variants = [{ id: "minimal", label: "Minimal" }];
    const markup = render("default");
    expect(markup).toContain("has not been checked in this session");
    expect(markup).not.toContain("is unavailable");
    expect(levelButtons(markup).map((button) => button.label)).toEqual(["Minimal"]);
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("keeps the saved choice after reload while allowing profile choices to update the profile", () => {
    expect(levelButtons(render("minimal")).find((button) => button.pressed)?.label).toBe("Minimal");
    const row = ModelVariantRow({ bot: selected(), updateBotDefault: true })!;
    const group = Children.toArray(row.props.children).at(-1) as ReactElement<{ children: ReactNode }>;
    (Children.toArray(group.props.children)[1] as ReactElement<{ onClick: () => void }>).props.onClick();
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: undefined, updateBotDefault: true,
      selection: { instanceId: "opencode", model: "provider/model", variant: "minimal" } });
  });

  it("drops an opaque variant when switching models/accounts but keeps it when reselecting the same model", () => {
    const selection = selected("minimal").modelSelection;
    expect(modelSelectionForPick(selection, opencode(), "provider/other")).toEqual({ instanceId: "opencode", model: "provider/other" });
    expect(modelSelectionForPick(selection, { ...opencode(), instanceId: "other" }, "provider/model")).toEqual({ instanceId: "other", model: "provider/model" });
    expect(modelSelectionForPick(selection, opencode(), "provider/model")).toEqual(selection);
    expect(modelSelectionForPick({ ...selection, effort: "high" }, opencode(), "provider/other")).not.toHaveProperty("effort");
    expect(modelSelectionForPick(bot("high").modelSelection, engine(["high"]), "other")).toEqual({ instanceId: "codex", model: "other", effort: "high" });
  });
});

describe("ModelPicker trigger", () => {
  const renderTrigger = (effort?: EffortLevel) => {
    fixture.instances = [engine(["low", "high"])];
    return renderToStaticMarkup(createElement(ModelPicker, { bot: bot(effort) }));
  };

  const effortChip = (markup: string) =>
    markup.match(/<span data-model-effort[^>]*>(.*?)<\/span>/s)?.[1].replace(/<!--.*?-->/g, "").trim();

  /** React HTML-escapes the apostrophe and may encode the newline numerically; both are undone here. */
  const tooltipLines = (markup: string): string[] => {
    const encoded = markup.match(/<button[^>]*\stitle="([^"]*)"/s)?.[1];
    if (encoded === undefined) return [];
    const amp = String.fromCharCode(38);
    const newline = String.fromCharCode(10);
    return encoded
      .replaceAll(amp + "#x27;", "'")
      .replaceAll(amp + "#10;", newline)
      .split(newline);
  };

  it("names the thread in busy header help and the bot in profile settings", () => {
    fixture.instances = [engine()];
    for (const threadId of ["independent-thread", undefined]) {
      const markup = renderToStaticMarkup(createElement(ModelPicker, { bot: { ...bot(), busy: true }, threadId }));
      expect(tooltipLines(markup)).toEqual([
        "Codex · GPT-5.6",
        `Stop this ${threadId ? "thread" : "bot"}'s turn before changing its model`,
      ]);
    }
  });

  it("puts the current model and effort above the busy advisory", () => {
    fixture.instances = [engine(["low", "high"])];
    const markup = renderToStaticMarkup(createElement(ModelPicker, { bot: { ...bot("high"), busy: true }, threadId: "independent-thread" }));
    expect(tooltipLines(markup)).toEqual([
      "Codex · GPT-5.6 · High effort",
      "Stop this thread's turn before changing its model",
    ]);
  });

  it("shows the model and its effort together in the composer pill", () => {
    const markup = renderTrigger("high");

    expect(markup).toContain("GPT-5.6");
    expect(effortChip(markup)).toBe("· High");
    expect(markup).toContain("Codex · GPT-5.6 · High effort");
    expect(markup).toContain('aria-label="Model: Codex · GPT-5.6 · High effort"');
  });

  it("says nothing about effort when the bot sends no level", () => {
    const markup = renderTrigger();

    expect(markup).toContain("GPT-5.6");
    expect(effortChip(markup)).toBeUndefined();
    expect(markup).not.toContain("effort");
    expect(markup).not.toContain("data-model-account");
  });

  it("folds to its provider mark on a narrow composer, dropping the effort first", () => {
    const markup = renderTrigger("high");
    expect(markup).toMatch(/<span class="[^"]*@max-\[22rem\]\/composer:hidden[^"]*">/);
    expect(markup).toMatch(/data-model-effort="true" class="[^"]*@max-\[30rem\]\/composer:hidden/);
  });

  it("drops a repeated Claude from the name the pill shows, but not from what it announces", () => {
    fixture.instances = [{ ...engine(), instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude",
      models: { default: "claude-sonnet-5", options: [{ id: "claude-sonnet-5", label: "Claude Sonnet 5" }] } }];
    const markup = renderToStaticMarkup(createElement(ModelPicker, { bot: { ...bot(), modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } } }));
    expect(markup).toContain('<span class="min-w-0 truncate">Sonnet 5</span>');
    expect(markup).toContain('aria-label="Model: Claude · Claude Sonnet 5"');
  });

  it("visibly identifies the selected account when Claude has multiple instances", () => {
    fixture.instances = [
      { ...engine(), instanceId: "claude-personal", driverKind: "claudeAgent", displayName: "Personal" },
      { ...engine(), instanceId: "claude-work", driverKind: "claudeAgent", displayName: "Work" },
    ];
    const markup = renderToStaticMarkup(createElement(ModelPicker, {
      bot: { ...bot(), modelSelection: { instanceId: "claude-work", model: "gpt-5.6" } },
    }));
    expect(markup).toMatch(/<span data-model-account[^>]*>Work · <\/span>/);
    expect(markup).not.toMatch(/<span data-model-account[^>]*>Personal/);
    expect(markup).toMatch(/data-model-account="true" class="[^"]*@max-\[34rem\]\/composer:hidden/);
  });
});

describe("model groups", () => {
  const codex: InstanceInfo = { ...engine(), instanceId: "codex", driverKind: "codex", displayName: "Codex" };
  const plan: InstanceInfo = { ...engine(), instanceId: "chatgpt", driverKind: "codex", displayName: "ChatGPT plan" };
  const apiKey: InstanceInfo = { ...engine(), instanceId: "openai", driverKind: "openai-compat", displayName: "OpenAI", access: "api" };
  const personal: InstanceInfo = { ...engine(), instanceId: "claude-personal", driverKind: "claudeAgent", displayName: "Personal" };
  const work: InstanceInfo = { ...engine(), instanceId: "claude-work", driverKind: "claudeAgent", displayName: "Work", access: "custom" };

  it("folds Codex and the ChatGPT plan into one OpenAI group, apart from the API-key OpenAI", () => {
    const groups = pickerGroups([codex, plan, apiKey], { instanceId: "chatgpt" });
    expect(groups.map((group) => [group.label, group.access, group.accounts.map((account) => account.instanceId)]))
      .toEqual([["OpenAI", "subscription", ["codex", "chatgpt"]], ["OpenAI", "api", ["openai"]]]);
    expect(groups[0]!.instance).toBe(plan);
    expect(groups.map((group) => group.current)).toEqual([true, false]);
  });

  it("shows the account chosen in the group, else the selected one, else the first that is ready", () => {
    expect(pickerGroups([codex, plan], { instanceId: "elsewhere" }, { openai: "chatgpt" })[0]!.instance).toBe(plan);
    expect(pickerGroups([personal, work], { instanceId: "claude-work" })[0]!.instance).toBe(work);
    const signedOut: InstanceInfo = { ...personal, snapshot: { state: "available", authenticated: false } };
    expect(pickerGroups([signedOut, work], { instanceId: "elsewhere" })[0]!.instance).toBe(work);
  });

  it("keeps one Claude group across plan and local accounts, current for either account", () => {
    for (const selected of [personal, work]) {
      const groups = pickerGroups([codex, personal, work], { instanceId: selected.instanceId });
      const claude = groups.filter((group) => group.label === "Claude");
      expect(claude).toHaveLength(1);
      expect(claude[0]!.current).toBe(true);
      expect(claude[0]!.accounts).toEqual([personal, work]);
      expect(groups.find((group) => group.label === "OpenAI")!.current).toBe(false);
    }
  });

  it("orders plans, then API keys, then local engines", () => {
    const local: InstanceInfo = { ...engine(), instanceId: "pi", driverKind: "piAgent", displayName: "pi", access: "custom",
      models: { default: "", options: [{ id: "qwen", label: "Qwen", custom: true }] } };
    expect(pickerGroups([local, apiKey, codex], { instanceId: "codex" }).map((group) => group.access)).toEqual(["subscription", "api", "custom"]);
  });

  it("suggests five models with the current and default first, and searches every model of the group", () => {
    const many = Array.from({ length: 8 }, (_, index) => ({ id: `m${index}`, label: `Model ${index}` }));
    const group = pickerGroups([{ ...codex, models: { default: "m3", options: many } }], { instanceId: "codex" })[0]!;
    expect(groupModels(group, "", false, "m6").shown.map((option) => option.id)).toEqual(["m6", "m3", "m0", "m1", "m2"]);
    expect(groupModels(group, "", false, "m6").more).toBe(3);
    expect(groupModels(group, "", true, "m6").shown).toHaveLength(8);
    expect(groupModels(group, "model 7", false, undefined).shown.map((option) => option.id)).toEqual(["m7"]);
  });

  it("maps named native options to concrete instances without committing a model", () => {
    const onSelect = vi.fn();
    const dropdown = ClaudeAccountSelect({ accounts: [personal, work], selectedId: work.instanceId, onSelect });
    const markup = renderToStaticMarkup(dropdown);
    expect(markup).toContain('aria-label="Account"');
    expect(markup).toContain('<option value="claude-personal">Personal</option>');
    expect(markup).toContain('<option value="claude-work" selected="">Work</option>');
    const select = Children.toArray(dropdown.props.children)[1] as ReactElement<{ onChange: (event: ChangeEvent<HTMLSelectElement>) => void }>;
    select.props.onChange({ target: { value: personal.instanceId } } as ChangeEvent<HTMLSelectElement>);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(personal);
  });
});

describe("the grouped model list", () => {
  const props = (instances: InstanceInfo[], selection = { instanceId: "codex", model: "gpt-5.6" }) => ({
    instances, selection, refreshing: false, onRefresh: vi.fn(), probing: null, onProbe: vi.fn(), onPick: vi.fn(),
    onSettings: vi.fn(), onApiKeys: vi.fn(), apiKeysLabel: "Add API keys", onClose: vi.fn(),
  });
  const row = (html: string, id: string) => {
    const start = html.indexOf(`data-model-row="${id}"`);
    return html.slice(start, html.indexOf("</button>", start));
  };

  it("lists each provider under its heading with a description, badges and a check on the current model", () => {
    const claude: InstanceInfo = { ...engine(), instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", access: "subscription",
      models: { default: "claude-sonnet-5", options: [{ id: "claude-opus-5-5", label: "Claude Opus 5.5", contextWindow: 1_000_000 }, { id: "claude-sonnet-5", label: "Claude Sonnet 5" }] } };
    const html = renderToStaticMarkup(createElement(ModelPickerList, props([engine(), claude], { instanceId: "claude", model: "claude-sonnet-5" })));
    expect(html).toContain('aria-label="Search models"');
    expect(html.indexOf('data-model-group="family:openai"')).toBeLessThan(html.indexOf('data-model-group="family:claude"'));
    expect(html).toContain('data-model-row="claude-sonnet-5" aria-current="true"');
    expect(html).not.toContain('data-model-row="claude-opus-5-5" aria-current');
    expect(row(html, "claude-sonnet-5")).toContain(">Default</span>");
    expect(row(html, "claude-opus-5-5")).toContain("Smartest. Best for hard, long jobs.");
    expect(row(html, "claude-opus-5-5")).toContain(">1M</span>");
    expect(html).toContain(">Your plan</span>");
  });

  it("shows an engine the organisation disallows as managed and dimmed, not hidden or pickable", () => {
    const blocked: InstanceInfo = { ...engine(), policy: { organizationName: "Fixture Agency", reason: "Fixture Agency allows only company models on this computer. Choose a Company model for this bot." } };
    const html = renderToStaticMarkup(createElement(ModelPickerList, props([blocked])));
    expect(html).toContain("Managed by Fixture Agency");
    expect(html).toContain("opacity-60");
    expect(html).toContain("data-policy-blocked");
    expect(html).not.toContain("data-model-row");
    expect(renderToStaticMarkup(createElement(ModelPickerList, props([engine()])))).not.toContain("Managed by");
  });

  it("puts an update behind one row instead of above the models", () => {
    const outdated: InstanceInfo = { ...engine(), snapshot: { ...engine().snapshot, update: { title: "Update Codex to 9.9.9", message: "A long explanation", command: "npm i -g codex" } } };
    const html = renderToStaticMarkup(createElement(ModelPickerList, props([outdated])));
    expect(html).toMatch(/data-model-update="true"[^>]*>(?:(?!<\/button>).)*Update Codex to 9\.9\.9/s);
    expect(html).not.toContain("A long explanation");
    expect(html).toContain('data-model-row="gpt-5.6"');
  });

  it("ends with a way to add API keys", () => {
    const html = renderToStaticMarkup(createElement(ModelPickerList, props([engine()])));
    expect(html).toMatch(/data-model-add-api-keys="true"[^>]*>(?:(?!<\/button>).)*Add API keys/s);
  });
});
