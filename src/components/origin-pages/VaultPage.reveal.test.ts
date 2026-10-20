// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const vault = vi.hoisted(() => ({ items: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/origin-cloud", () => ({ useCloudQuery: () => vault.items, cloudMutation: vi.fn() }));
vi.mock("./vaultCrypto", () => ({
  decryptSecret: async (payload: { ciphertext: string }) => `plain ${payload.ciphertext}`,
  encryptSecret: vi.fn(), generatePassword: vi.fn(),
}));
vi.mock("./ui", async (original) => ({
  ...await original<typeof import("./ui")>(),
  CloudGate: ({ children }: { children(gate: { projectId: string; canEdit: boolean }): ReactNode }) => children({ projectId: "p", canEdit: true }),
}));
const { VaultPage } = await import("./VaultPage");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const credential = (ciphertext: string) => ({ _id: "key", title: "API key", kind: "api_key", ciphertext, iv: "iv", salt: "salt", iterations: 1, kdf: "PBKDF2-SHA256", updatedAt: 1 });

it("hides a revealed secret once its stored value changes", async () => {
  vault.items = [credential("one")];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const page = () => createElement(VaultPage, { cloudProjectId: "p", projectName: "Project" });
  act(() => root.render(page()));
  const passphrase = host.querySelector<HTMLInputElement>('input[type="password"]')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(passphrase, "passphrase"); passphrase.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { passphrase.form!.requestSubmit(); });
  await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="Reveal API key"]')!.click(); });
  expect(host.querySelector("code")?.textContent).toBe("plain one");
  vault.items = [credential("two")];
  act(() => root.render(page()));
  expect(host.querySelector("code")).toBeNull();
  expect(host.querySelector('button[aria-label="Reveal API key"]')).not.toBeNull();
  act(() => root.unmount());
});
