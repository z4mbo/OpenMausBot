// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialDesktopCapabilities } from "@/lib/desktop";
import { setLocale } from "@/lib/i18n";
import { initialState, StoreContext, type Bot } from "@/state/store";

vi.mock("@/lib/sidebar-preferences", async (original) => ({
  ...await original<typeof import("@/lib/sidebar-preferences")>(),
  loadSidebarWidth: () => 280,
  useSidebarDensity: () => "comfortable",
}));
vi.mock("@/lib/origin-cloud", async (original) => ({
  ...await original<typeof import("@/lib/origin-cloud")>(),
  useCloudQuery: () => undefined,
  useCloudSession: () => ({ ready: true, token: null, user: null, logout: async () => {} }),
}));
const page = vi.hoisted(() => ({ open: null as string | null }));
vi.mock("@/lib/origin-pages", async (original) => ({
  ...await original<typeof import("@/lib/origin-pages")>(),
  useOriginPage: () => page.open,
}));
vi.mock("./DesktopCapabilities", async (original) => ({
  ...await original<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: initialDesktopCapabilities(), ready: true }),
}));

import { Sidebar } from "./Sidebar";

const chief: Bot = { id: "chief", name: "Fixture project", title: "Chief", color: "green", messages: [], notifications: false, unread: false,
  modelSelection: { instanceId: "fixture", model: "fixture" }, threadId: "thread-chief", description: "", section: "Fixture project", chiefOfStaff: true };

beforeEach(() => {
  vi.stubGlobal("window", { innerWidth: 1280, location: { protocol: "http:", search: "" }, ogb: { platform: "win32" } });
  setLocale("en");
});
afterEach(() => { page.open = null; vi.unstubAllGlobals(); });

const currentRow = () => {
  const state = { ...initialState, bots: [chief], selectedId: chief.id, activeView: "chat" as const };
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(StoreContext.Provider, { value: { state, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} } },
    createElement(Sidebar, { open: true, onClose: () => {} })));
  return host.querySelector(`[data-sidebar-bot-row="${chief.id}"]`)!.getAttribute("aria-current");
};

it("marks the open project as current only while its chat is what the window shows", () => {
  expect(currentRow()).toBe("page");
  page.open = "inbox";
  expect(currentRow()).toBeNull();
});
