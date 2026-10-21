// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const vault = vi.hoisted(() => ({ items: [] as Array<Record<string, unknown>>, events: [] as string[], share: null as null | (() => void) }));
vi.mock("@/lib/origin-cloud", () => ({ useCloudQuery: () => vault.items, cloudMutation: vi.fn(async () => null) }));
vi.mock("./vaultCrypto", () => ({
  decryptSecret: async (payload: { ciphertext: string }) => `plain ${payload.ciphertext}`,
  encryptSecret: async (secret: string) => ({ ciphertext: `sealed ${secret}`, iv: "iv", salt: "salt", iterations: 1, kdf: "kdf" }),
  generatePassword: vi.fn(),
}));
vi.mock("./vault-agent", () => ({
  shareUnlockedWithAgents: () => new Promise<void>((resolve) => { vault.share = () => { vault.events.push("shared"); resolve(); }; }),
  forgetForAgents: async () => { vault.events.push("forgotten"); },
  handOver: async (_projectId: string, item: { ciphertext: string }) => { vault.events.push(`handed ${item.ciphertext}`); },
  setAgentUse: vi.fn(),
}));
vi.mock("./ui", async (original) => ({
  ...await original<typeof import("./ui")>(),
  CloudGate: ({ children }: { children(gate: { projectId: string; canEdit: boolean }): ReactNode }) => children({ projectId: "p", canEdit: true }),
}));
const { VaultPage } = await import("./VaultPage");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const setValue = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const button = (host: ParentNode, name: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === name || item.getAttribute("aria-label") === name)!;

async function unlocked() {
  vault.events = [];
  vault.items = [{ _id: "key", title: "API key", kind: "api_key", agentUse: true, ciphertext: "one", iv: "iv", salt: "salt", iterations: 1, kdf: "kdf", updatedAt: 1 }];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(VaultPage, { cloudProjectId: "p", projectName: "Project" })));
  act(() => setValue(host.querySelector<HTMLInputElement>('input[type="password"]')!, "passphrase"));
  await act(async () => { host.querySelector("form")!.requestSubmit(); });
  return { host, unmount: () => act(() => root.unmount()) };
}

it("takes secrets back from agents only after a handover still in flight has landed", async () => {
  const { host, unmount } = await unlocked();
  await act(async () => { button(host, "Lock").click(); });
  expect(vault.events).toEqual([]);
  await act(async () => { vault.share!(); });
  expect(vault.events).toEqual(["shared", "forgotten"]);
  unmount();
});

it("gives agents the new value of a secret they may use once it is edited", async () => {
  const { host, unmount } = await unlocked();
  await act(async () => { vault.share!(); });
  act(() => button(host, "Edit API key").click());
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  act(() => setValue(dialog.querySelector<HTMLInputElement>('input[type="password"]')!, "rotated"));
  await act(async () => { dialog.querySelector("form")!.requestSubmit(); });
  expect(vault.events).toContain("handed sealed rotated");
  unmount();
});
