// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const vault = vi.hoisted(() => ({ calls: [] as Array<[string, Record<string, unknown>]>, queried: [] as string[] }));
vi.mock("@/lib/origin-cloud", () => ({
  useCloudQuery: (name: string) => {
    vault.queried.push(name);
    return name === "personalCredentials:list" ? [] : [{ _id: "shared", title: "Shared key", kind: "api_key", ciphertext: "one", iv: "iv", salt: "salt", iterations: 1, kdf: "kdf", updatedAt: 1 }];
  },
  cloudMutation: vi.fn(async (name: string, args: Record<string, unknown>) => { vault.calls.push([name, args]); return null; }),
}));
vi.mock("./vaultCrypto", () => ({
  decryptSecret: async () => "",
  encryptSecret: async (secret: string) => ({ ciphertext: `sealed ${secret}`, iv: "iv", salt: "salt", iterations: 1, kdf: "kdf" }),
  generatePassword: vi.fn(),
}));
vi.mock("./vault-agent", () => ({ shareUnlockedWithAgents: async () => 0, forgetForAgents: async () => undefined, handOver: vi.fn(), setAgentUse: vi.fn() }));
vi.mock("./ui", async (original) => ({
  ...await original<typeof import("./ui")>(),
  CloudGate: ({ children }: { children(gate: { projectId: string; canEdit: boolean }): ReactNode }) => children({ projectId: "p", canEdit: false }),
}));
const { VaultPage } = await import("./VaultPage");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const setValue = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const button = (host: ParentNode, name: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === name || item.getAttribute("aria-label") === name)!;

it("keeps a personal vault, editable by a project viewer, whose service sign-in saves its environment variables", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(VaultPage, { cloudProjectId: "p", projectName: "Project" })));
  expect(host.textContent).toContain("Shared key");
  act(() => button(host, "Personal").click());
  expect(vault.queried).toContain("personalCredentials:list");
  expect(host.textContent).not.toContain("Shared key");
  expect(host.textContent).toContain("Only you see them");

  act(() => setValue(host.querySelector<HTMLInputElement>('input[type="password"]')!, "a long personal passphrase"));
  await act(async () => { host.querySelector("form")!.requestSubmit(); });
  act(() => button(host, "New item").click());
  const dialog = document.body;
  const type = dialog.querySelector<HTMLSelectElement>("select")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(type, "service");
    type.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const token = [...dialog.querySelectorAll<HTMLInputElement>('input[type="password"]')].at(-1)!;
  expect(dialog.textContent).toContain("VERCEL_TOKEN");
  act(() => setValue(token, "vercel_token_abcdefghij"));
  await act(async () => { button(dialog, "Save encrypted item").closest("form")!.requestSubmit(); });

  const [name, args] = vault.calls.at(-1)!;
  expect(name).toBe("personalCredentials:create");
  expect(args).toMatchObject({ kind: "service", service: "vercel", title: "Vercel", ciphertext: `sealed ${JSON.stringify({ VERCEL_TOKEN: "vercel_token_abcdefghij" })}` });
  expect(args).not.toHaveProperty("projectId");
  act(() => root.unmount());
});
