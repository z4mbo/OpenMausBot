// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { chiefSectionOf, setChiefSectionOf } from "@/lib/origin-chief-section";
import { currentOriginPage, openOriginPage } from "@/lib/origin-pages";

const store = vi.hoisted(() => ({ dispatch: vi.fn(), state: {} as Record<string, unknown> }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: store.state, dispatch: store.dispatch }) };
});
vi.mock("./Spotlight", () => ({ Spotlight: ({ children }: { children: ReactNode }) => createElement("div", null, children) }));
const { initialState } = await import("@/state/store");
const { GuidedTour } = await import("./GuidedTour");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("brings the chat and its composer back before the tour's first step", () => {
  store.state = { ...initialState, tourOpen: true, activeView: "files", selectedId: "lead", config: { onboarding: { completedAt: 1, hintsSeen: [] } } };
  setChiefSectionOf("lead", "issues");
  openOriginPage("inbox");
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(createElement(GuidedTour)));
  expect(store.dispatch).toHaveBeenCalledWith({ type: "showChat" });
  expect(currentOriginPage()).toBeNull();
  expect(chiefSectionOf("lead")).toBe("chat");
  act(() => root.unmount());
});
