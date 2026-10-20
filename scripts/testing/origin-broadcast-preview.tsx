import { createRoot } from "react-dom/client";
import { BroadcastPage } from "../../src/components/origin-broadcast/BroadcastPage";
import { initialState, StoreContext, type Action, type Bot } from "../../src/state/store";
import { applySkin } from "../../src/lib/skins";
import { GlassHeaderFrame } from "../../src/components/GlassScrollFrame";
import "../../src/styles.css";

applySkin(new URLSearchParams(location.search).get("theme") === "light" ? "daylight" : "midnight");
const chief = { id: "fixture-chief", name: "Atlas", title: "Chief", chiefOfStaff: true, color: "green", section: "Fixture project", messages: [], modelSelection: { instanceId: "fixture", model: "fixture" }, threadId: "fixture-thread", description: "", notifications: false, unread: false } as Bot;
const dispatched: Action[] = [];
Object.assign(window, { originBroadcastDispatched: dispatched });

createRoot(document.getElementById("root")!).render(
  <StoreContext.Provider value={{ state: initialState, dispatch: (action) => { dispatched.push(action); }, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}>
    <main className="flex h-dvh min-w-0 flex-col bg-app text-ink">
      <GlassHeaderFrame className="flex min-h-0 flex-1 flex-col [--glass-tint:var(--color-app)]" barClassName="z-[25]" bar={<div className="h-2" />}>
        <BroadcastPage agent={chief} cloudProjectId="fixture-project" projectName="Fixture project" />
      </GlassHeaderFrame>
    </main>
  </StoreContext.Provider>,
);
