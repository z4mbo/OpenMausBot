// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ profile: { name: "Ada", email: "ada@example.test" } }));
vi.mock("@/state/store", async (original) => ({ ...await original<object>(), useStore: () => ({ state: { config: { profile: fixture.profile } }, dispatch: vi.fn() }) }));
vi.mock("./AboutMeSettings", () => ({ AboutMeSettings: () => null }));
import { ProfileFields } from "./SettingsModal";

let host: HTMLDivElement;
let root: Root;
const field = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const type = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(ProfileFields)));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("keeps the email being typed when the saved name comes back", async () => {
  const name = field("Your name");
  const email = field("Email");
  await act(async () => type(name, "Ada L."));
  await act(async () => type(email, "ada.lovelace@exam"));
  fixture.profile = { name: "Ada L.", email: "ada@example.test" };
  await act(async () => root.render(createElement(ProfileFields)));
  expect(name.value).toBe("Ada L.");
  expect(email.value).toBe("ada.lovelace@exam");
});
