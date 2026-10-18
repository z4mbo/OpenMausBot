// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialDesktopCapabilities } from "@/lib/desktop";
import { setLocale } from "@/lib/i18n";
import { StoreProvider } from "@/state/store";

const fixture = vi.hoisted(() => ({ width: 240, platform: "win32", advanced: true }));
const username = "SyntheticAccountNameWithFortyCharactersX";
vi.mock("@/lib/sidebar-preferences", async original => ({
  ...await original<typeof import("@/lib/sidebar-preferences")>(),
  loadSidebarWidth: () => fixture.width,
  useSidebarDensity: () => "comfortable",
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: () => {} }));
vi.mock("@/lib/origin-cloud", async original => ({
  ...await original<typeof import("@/lib/origin-cloud")>(),
  useCloudQuery: (name: string) => name === "auth:me" ? { _id: "fixture-user", username: "SyntheticAccountNameWithFortyCharactersX", email: "fixture@example.test" } : undefined,
  useCloudSession: () => ({ ready: true, token: null, user: null, logout: async () => {} }),
}));
vi.mock("./DesktopCapabilities", async original => ({
  ...await original<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: initialDesktopCapabilities(), ready: true }),
}));

import { Sidebar } from "./Sidebar";

beforeEach(() => {
  vi.stubGlobal("window", { innerWidth: 1280, location: { protocol: "http:", search: "" }, ogb: { platform: fixture.platform, workspaces: { state: async () => ({ local: true, name: "This computer" }), menu: async () => {} } } });
  setLocale("en");
});
afterEach(() => { vi.unstubAllGlobals(); setLocale("en"); });

const cases = (["darwin", "win32"] as const).flatMap(platform => [240, 272, 320].flatMap(width => [true, false].map(advanced => ({ platform, width, advanced }))));
it.each(cases)("reserves an independent identity row at $width on $platform (Advanced $advanced)", ({ platform, width, advanced }) => {
  Object.assign(fixture, { platform, width, advanced });
  window.ogb!.platform = platform;
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(StoreProvider, null, createElement(Sidebar, { open: true, onClose: () => {} })));
  const titlebar = host.querySelector<HTMLElement>("[data-sidebar-top-row]")!;
  const identity = host.querySelector<HTMLElement>("[data-sidebar-identity-row]");
  expect(identity).not.toBeNull();
  expect(identity!.classList.contains("relative")).toBe(true);
  expect(titlebar.contains(identity)).toBe(false);
  expect(titlebar.compareDocumentPosition(identity!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(titlebar.querySelector("[data-origin-account]")).toBeNull();
  expect(titlebar.querySelector("[data-workspace-switcher]")).toBeNull();
  expect(identity!.querySelectorAll('[aria-label="Open account menu"]')).toHaveLength(1);
  expect(identity!.querySelector("[data-origin-account]")!.textContent).toContain(username);
  expect(identity!.querySelectorAll('[data-tour="server-switcher"]')).toHaveLength(1);
  expect(identity!.getAttribute("style")).toContain("-webkit-app-region:no-drag");
  expect(host.querySelector("[data-sidebar]")!.getAttribute("style")).toContain(`--sidebar-width:${width}px`);
  const account = identity!.querySelector('[aria-label="Open account menu"]')!;
  expect(account.parentElement!.classList.contains("min-w-0")).toBe(true);
  expect(account.parentElement!.classList.contains("max-w-full")).toBe(true);
  expect(identity!.querySelector("[data-sidebar-top-switcher]")!.classList.contains("max-w-[min(140px,50%)]")).toBe(true);
  expect(titlebar.querySelector("[data-traffic-light-space]") !== null).toBe(platform === "darwin");
  expect(titlebar.querySelector('[aria-label="Collapse sidebar to avatars"]') !== null).toBe(advanced);
});
