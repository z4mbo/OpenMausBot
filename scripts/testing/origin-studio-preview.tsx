import { createRoot } from "react-dom/client";
import { StudioPage } from "../../src/components/origin-studio/StudioPage";
import { AssetsPage } from "../../src/components/origin-pages/AssetsPage";
import { BroadcastPage } from "../../src/components/origin-broadcast/BroadcastPage";
import { initialState, StoreContext, type Bot } from "../../src/state/store";
import { applySkin } from "../../src/lib/skins";
import { GlassHeaderFrame } from "../../src/components/GlassScrollFrame";
import "../../src/styles.css";

const config = await (await fetch("/__origin-campaigns.json")).json() as { projectId: string };
const params = new URLSearchParams(location.search);
applySkin(params.get("theme") === "light" ? "daylight" : "midnight");
const chief = { id: "fixture-chief", name: "Atlas", title: "Chief", chiefOfStaff: true, color: "green", section: "Fixture project", messages: [], modelSelection: { instanceId: "fixture", model: "fixture" }, threadId: "fixture-thread", description: "", notifications: false, unread: false } as Bot;
const page = params.get("page") === "assets"
  ? <AssetsPage cloudProjectId={config.projectId} projectName="Fixture project" />
  : params.get("page") === "broadcast"
    ? <BroadcastPage agent={chief} cloudProjectId={config.projectId} projectName="Fixture project" />
    : <StudioPage agent={chief} cloudProjectId={config.projectId} projectName="Fixture project" />;

createRoot(document.getElementById("root")!).render(
  <StoreContext.Provider value={{ state: initialState, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}>
    <main className="flex h-dvh min-w-0 flex-col bg-app text-ink">
      <GlassHeaderFrame className="flex min-h-0 flex-1 flex-col [--glass-tint:var(--color-app)]" barClassName="z-[25]" bar={<div className="h-2" />}>
        {page}
      </GlassHeaderFrame>
    </main>
  </StoreContext.Provider>,
);
