// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bot, InstanceInfo } from "@/state/store";

const fixture = vi.hoisted(() => ({
  instances: [] as InstanceInfo[],
  dispatch: vi.fn(),
  refreshInstances: vi.fn(() => Promise.resolve()),
  refreshModels: vi.fn((_id: string) => Promise.resolve()),
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  api: vi.fn(async () => ({})),
  useStore: () => ({
    state: { instances: fixture.instances, bots: [], modelVariantSessions: {}, config: null },
    dispatch: fixture.dispatch,
    refreshInstances: fixture.refreshInstances,
    refreshModels: fixture.refreshModels,
  }),
}));
// These cases cover the full picker; Simple mode has its own file.
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("./ModelFallbackSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ModelFallbackSettings")>()),
  ModelFallbackSettings: () => null,
}));
vi.mock("./RemoteModelPicker", () => ({ RemoteModelPicker: () => null }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));

const { LOCAL_PROBE_TIMEOUT_MS, ModelPicker, offersLocalModels, probeLocalModels } = await import("./ModelPicker");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const official = [{ id: "claude-opus-5-5", label: "Opus 5.5" }, { id: "claude-sonnet-5", label: "Sonnet 5" }];
const qwen = { id: "ollama::qwen3", label: "qwen3 (Ollama)", custom: true };
const claudeInstall = {
  command: { darwin: "npm install -g @anthropic-ai/claude-code", linux: "npm install -g @anthropic-ai/claude-code", win32: "npm install -g @anthropic-ai/claude-code" },
  signInCommand: "claude",
};
const claude = (snapshot: InstanceInfo["snapshot"], options: InstanceInfo["models"]["options"] = official): InstanceInfo => ({
  instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", access: "subscription", snapshot,
  models: { default: "claude-opus-5-5", options }, install: claudeInstall,
  authentication: { method: "paste-code", signOut: true },
});
const signedOut = () => claude({ state: "available", version: "2.1.300", authenticated: false });
const signedIn = () => claude({ state: "available", version: "2.1.300", authenticated: true });
const notFound = () => claude({ state: "unavailable", reason: "`claude` CLI not found" });
const codex: InstanceInfo = {
  instanceId: "codex", driverKind: "codex", displayName: "Codex", access: "subscription",
  snapshot: { state: "available", version: "1.0.0", authenticated: true },
  models: { default: "gpt-5.6", options: [{ id: "gpt-5.6", label: "GPT-5.6" }, { id: "gpt-5.6-mini", label: "GPT-5.6 mini" }] },
};

function bot(instanceId: string, model: string): Bot {
  return {
    id: "atlas", threadId: "thread-atlas", name: "Atlas", title: "", description: "", notifications: true,
    color: "green", unread: false, modelSelection: { instanceId, model }, messages: [],
  };
}

let host: HTMLDivElement;
let root: Root;
let current: Bot;
const show = (forBot: Bot = current) => { current = forBot; act(() => root.render(createElement(ModelPicker, { bot: forBot, threadId: forBot.threadId }))); };
const picker = () => host.querySelector<HTMLElement>("[data-model-picker-content]");
const text = () => picker()?.textContent ?? "";
const button = (selector: string) => host.querySelector<HTMLButtonElement>(selector);
const click = (element: Element | null) => act(() => { (element as HTMLElement).click(); });
const open = async (forBot: Bot) => {
  show(forBot);
  await act(async () => {
    button('[data-tour="model"]')!.click();
    for (let index = 0; index < 5; index++) await Promise.resolve();
  });
};
const press = (key: string, target: Element = document.activeElement!) => act(() => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
});
const typeIn = (input: HTMLInputElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const flush = async () => { await act(async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); }); };

beforeEach(() => {
  document.documentElement.dataset.reducedMotion = "true";
  fixture.dispatch = vi.fn();
  fixture.refreshInstances = vi.fn(() => Promise.resolve());
  fixture.refreshModels = vi.fn(() => Promise.resolve());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("ModelPicker with a signed-out or missing Claude", () => {
  it("keeps an empty ChatGPT plan catalog reachable, one account switch from its sign-in", async () => {
    const plan: InstanceInfo = { ...codex, instanceId: "chatgpt", displayName: "ChatGPT plan", snapshot: { state: "available", authenticated: false, chatgptPlan: true }, models: { default: "", options: [] }, authentication: { method: "browser-pkce" }, install: { signInCommand: "codex login" } };
    fixture.instances = [codex, plan];
    await open(bot("codex", "gpt-5.6"));
    const account = host.querySelector<HTMLSelectElement>('select[aria-label="OpenAI account"]')!;
    expect([...account.options].map((option) => option.value)).toEqual(["codex", "chatgpt"]);
    act(() => {
      account.value = "chatgpt";
      account.dispatchEvent(new Event("change", { bubbles: true }));
    });
    click(button("[data-model-sign-in]"));
    expect(text()).toContain("Continue with ChatGPT");
    expect(text()).toContain("Available models appear after");
    expect(text()).not.toContain("codex login");
    expect(text()).not.toContain("Local models will appear");
  });

  it("keeps a signed-out Claude in the list as a sign-in, not as pickable cloud models", async () => {
    fixture.instances = [codex, signedOut()];
    await open(bot("codex", "gpt-5.6"));
    expect(host.querySelector('[data-model-group="family:claude"]')).not.toBeNull();
    expect(host.querySelector('[data-model-row="claude-opus-5-5"]')).toBeNull();
    expect(button("[data-model-sign-in]")?.textContent).toContain("Sign in to Claude");
    click(button("[data-model-sign-in]"));
    expect(host.querySelector("[data-claude-sign-in]")).not.toBeNull();
    expect(text()).toContain("2 models will appear after setup.");
    expect(text()).not.toContain("No model providers are available.");
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("goes back to the list with Escape and the back button", async () => {
    fixture.instances = [codex, signedOut()];
    await open(bot("codex", "gpt-5.6"));
    click(button("[data-model-sign-in]"));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Back to models");
    press("Escape");
    expect(picker()).not.toBeNull();
    expect(host.querySelector("[data-model-sign-in]")).not.toBeNull();
    click(button("[data-model-sign-in]"));
    click(button("[data-picker-back]"));
    expect(host.querySelector('[data-model-row="gpt-5.6"]')).not.toBeNull();
  });

  it("shows the sign-in first when the bot's own Claude is signed out", async () => {
    fixture.instances = [signedOut()];
    await open(bot("claude", "claude-opus-5-5"));
    expect(button("[data-model-sign-in]")?.textContent).toContain("Sign in to Claude");
    expect(host.querySelector('[data-model-row="claude-opus-5-5"]')).toBeNull();
    expect(text()).not.toContain("No model providers are available.");
  });

  it("keeps the bot's own Claude with its install card when the CLI is not found", async () => {
    fixture.instances = [codex, notFound()];
    await open(bot("claude", "claude-opus-5-5"));
    expect(host.querySelector("[data-model-local-entry]")).toBeNull();
    click(button("[data-model-setup]"));
    expect(text()).toContain("Set up Claude");
    expect(text()).toContain("`claude` CLI not found");
    expect(text()).toContain("npm install -g @anthropic-ai/claude-code");
  });

  it("leaves a Claude that is not found and not in use in Settings", async () => {
    fixture.instances = [codex, notFound()];
    await open(bot("codex", "gpt-5.6"));
    expect(host.querySelector('[data-model-group="family:claude"]')).toBeNull();
    expect(button('[aria-label="Model providers and accounts"]')).not.toBeNull();
  });
});

describe("the way into API keys and providers", () => {
  it("opens Settings on the API keys section from the end of the list", async () => {
    fixture.instances = [codex];
    await open(bot("codex", "gpt-5.6"));
    expect(button("[data-model-add-api-keys]")?.textContent).toBe("Add API keys");
    click(button("[data-model-add-api-keys]"));
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "connections" });
    expect(picker()).toBeNull();
  });

  it("says the shortcut changes keys too once a key is saved", async () => {
    const openai: InstanceInfo = {
      instanceId: "openai", driverKind: "openai-compat", displayName: "OpenAI", access: "api",
      snapshot: { state: "available", authenticated: true, version: null },
      models: { default: "gpt-5", options: [{ id: "gpt-5", label: "GPT-5" }] },
    };
    fixture.instances = [codex, openai];
    await open(bot("codex", "gpt-5.6"));
    expect(button("[data-model-add-api-keys]")?.textContent).toBe("Add or change API keys");
    expect(host.querySelector('[data-model-group="family:openai"]')?.textContent).toContain("Your plan");
    expect(host.querySelectorAll("[data-model-group]")[1]?.textContent).toContain("API key");
  });

  it("opens provider settings from the search row", async () => {
    fixture.instances = [codex];
    await open(bot("codex", "gpt-5.6"));
    click(button('[aria-label="Model providers and accounts"]'));
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "engines" });
  });
});

describe("the way into local models", () => {
  it.each([["signed in", signedIn], ["signed out", signedOut]])("shows for a %s Claude with no local models found yet, and re-probes when opened", async (_state, make) => {
    fixture.instances = [make()];
    let answer!: () => void;
    fixture.refreshModels = vi.fn(() => new Promise<void>((resolve) => { answer = resolve; }));
    await open(bot("claude", "claude-opus-5-5"));
    const entry = button("[data-model-local-entry]")!;
    expect(entry.getAttribute("aria-label")).toBe("Use a local model");
    expect(entry.disabled).toBe(false);

    click(entry);
    expect(fixture.refreshModels).toHaveBeenCalledExactlyOnceWith("claude");
    expect(picker()?.querySelector('[role="status"]')?.textContent).toBe("Looking for local models…");
    expect(text()).not.toContain("No local models found");

    fixture.instances = [make()];
    fixture.instances[0].models.options = [...official, qwen];
    answer();
    await flush();
    show();
    expect(text()).not.toContain("Looking for local models…");
    expect(host.querySelector(`[data-model-row="${qwen.id}"]`)?.textContent).toContain("qwen3 (Ollama)");
  });

  it("says nothing was found once the probe settles empty", async () => {
    fixture.instances = [signedIn()];
    await open(bot("claude", "claude-opus-5-5"));
    click(button("[data-model-local-entry]"));
    await flush();
    expect(text()).not.toContain("Looking for local models…");
    expect(text()).toContain("No local models found");
  });

  it("lets a signed-out Claude run a local model it already found", async () => {
    fixture.instances = [claude({ state: "available", authenticated: false }, [...official, qwen])];
    await open(bot("claude", "claude-opus-5-5"));
    const entry = button("[data-model-local-entry]")!;
    expect(entry.getAttribute("aria-label")).toBe("Use a local model (1 available)");
    click(entry);
    click(button(`[data-model-row="${qwen.id}"]`));
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "setModel", botId: "atlas", threadId: "thread-atlas", selection: { instanceId: "claude", model: qwen.id },
    }));
  });

  it("is offered by Claude whenever its CLI is present, and by other engines once they list a local model", async () => {
    expect(offersLocalModels(signedIn(), 0)).toBe(true);
    expect(offersLocalModels(signedOut(), 0)).toBe(true);
    expect(offersLocalModels(notFound(), 0)).toBe(false);
    expect(offersLocalModels({ ...signedIn(), policy: { organizationName: "Fixture", reason: "Not allowed" } }, 0)).toBe(false);
    expect(offersLocalModels(codex, 0)).toBe(false);
    expect(offersLocalModels(codex, 2)).toBe(true);
    expect(offersLocalModels(undefined, 0)).toBe(false);
  });

  it("stops looking after a short timeout and never throws", async () => {
    vi.useFakeTimers();
    let settled = false;
    void probeLocalModels("claude", () => new Promise(() => {})).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(LOCAL_PROBE_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    await expect(probeLocalModels("claude", () => Promise.reject(new Error("offline")))).resolves.toBeUndefined();
  });
});

describe("finding and picking a model with the keyboard", () => {
  it("opens with the search focused, walks the rows with the arrow keys and returns to the search", async () => {
    fixture.instances = [codex, signedIn()];
    await open(bot("codex", "gpt-5.6"));
    const search = host.querySelector<HTMLInputElement>('input[aria-label="Search models"]')!;
    expect(document.activeElement).toBe(search);
    press("ArrowDown");
    expect(document.activeElement?.getAttribute("data-model-row")).toBe("gpt-5.6");
    press("ArrowDown");
    expect(document.activeElement?.getAttribute("data-model-row")).toBe("gpt-5.6-mini");
    press("End");
    expect(document.activeElement?.hasAttribute("data-model-add-api-keys")).toBe(true);
    press("Home");
    expect(document.activeElement?.getAttribute("data-model-row")).toBe("gpt-5.6");
    press("ArrowUp");
    expect(document.activeElement).toBe(search);
  });

  it("keeps the rows to one Tab stop that starts on the current model and follows the arrow keys", async () => {
    fixture.instances = [codex, signedIn()];
    await open(bot("claude", "claude-sonnet-5"));
    const stops = () => [...host.querySelectorAll<HTMLElement>("[data-picker-item]")].filter((item) => item.tabIndex === 0);
    expect(stops().map((item) => item.getAttribute("data-model-row"))).toEqual(["claude-sonnet-5"]);
    press("ArrowDown");
    expect(stops()).toEqual([document.activeElement]);
    const row = document.activeElement!;
    press(" ");
    expect(document.activeElement).toBe(row);
    press("s");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Search models");
  });

  it("filters every provider's models as you type and picks the first match with Enter", async () => {
    fixture.instances = [codex, signedIn()];
    await open(bot("codex", "gpt-5.6"));
    const search = host.querySelector<HTMLInputElement>('input[aria-label="Search models"]')!;
    typeIn(search, "sonnet");
    expect([...host.querySelectorAll("[data-model-row]")].map((row) => row.getAttribute("data-model-row"))).toEqual(["claude-sonnet-5"]);
    expect(host.querySelector('[data-model-group="family:openai"]')).toBeNull();
    press("Enter", search);
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "setModel", botId: "atlas", threadId: "thread-atlas", updateBotDefault: false, selection: { instanceId: "claude", model: "claude-sonnet-5" },
    }));
    expect(picker()).toBeNull();
    expect(document.activeElement).toBe(button('[data-tour="model"]'));
  });

  it("clears the search with Escape before closing and handing focus back to the pill", async () => {
    fixture.instances = [codex];
    await open(bot("codex", "gpt-5.6"));
    const search = host.querySelector<HTMLInputElement>('input[aria-label="Search models"]')!;
    typeIn(search, "nothing like this");
    expect(text()).toContain("Nothing matches “nothing like this”");
    press("Escape", search);
    expect(search.value).toBe("");
    expect(picker()).not.toBeNull();
    press("Escape", search);
    expect(picker()).toBeNull();
    expect(document.activeElement).toBe(button('[data-tour="model"]'));
  });

  it("sets the effort for the current model from the footer and applies picks to the bot when asked", async () => {
    fixture.instances = [{ ...codex, capabilities: { effortLevels: ["low", "medium", "high"] } }];
    await open(bot("codex", "gpt-5.6"));
    const effort = host.querySelector('[role="group"][aria-label="Reasoning effort"]')!;
    expect([...effort.querySelectorAll("button")].map((segment) => [segment.textContent, segment.getAttribute("aria-pressed")]))
      .toEqual([["Default", "true"], ["Low", "false"], ["Medium", "false"], ["High", "false"]]);
    click([...effort.querySelectorAll("button")].find((segment) => segment.textContent === "High")!);
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: "thread-atlas", selection: { instanceId: "codex", model: "gpt-5.6", effort: "high" } });
    const scope = host.querySelector('[role="group"][aria-label="Apply model changes to"]')!;
    click([...scope.querySelectorAll("button")].find((segment) => segment.textContent === "Thread + bot default")!);
    click(button('[data-model-row="gpt-5.6-mini"]'));
    expect(fixture.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ updateBotDefault: true, selection: { instanceId: "codex", model: "gpt-5.6-mini" } }));
  });
});
