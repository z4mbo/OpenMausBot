import { createRoot } from "react-dom/client";
import { StudioPage } from "../../src/components/origin-studio/StudioPage";
import { AssetsPage } from "../../src/components/origin-pages/AssetsPage";
import { DrawingCanvas } from "../../src/components/origin-pages/DrawingCanvas";
import { initialState, StoreContext, type Action, type Bot } from "../../src/state/store";
import { applySkin } from "../../src/lib/skins";
import { GlassHeaderFrame } from "../../src/components/GlassScrollFrame";
import "../../src/styles.css";

const config = await (await fetch("/__origin-campaigns.json")).json() as { projectId: string; teamId: string; canvasId: string };
const params = new URLSearchParams(location.search);
applySkin(params.get("theme") === "light" ? "daylight" : "midnight");
const chief = { id: "fixture-chief", name: "Atlas", title: "Chief", chiefOfStaff: true, color: "green", section: "Lumen", messages: [], modelSelection: { instanceId: "fixture", model: "fixture" }, threadId: "fixture-thread", description: "", notifications: false, unread: false } as Bot;
const dispatched: Action[] = [];
Object.assign(window, { originBrandDispatched: dispatched });
const viewer = params.has("viewer");
const screen = params.get("page") ?? "brand";
const page = screen === "canvas"
  ? <div className="flex min-h-0 flex-1 flex-col pt-[var(--glass-top,0px)]"><DrawingCanvas teamId={config.teamId} canvasId={config.canvasId} projectId={config.projectId} userId="fixture-user" name="Landing" readOnly={viewer} /></div>
  : screen === "studio" ? <StudioPage agent={chief} cloudProjectId={config.projectId} projectName="Lumen" />
    : <AssetsPage cloudProjectId={config.projectId} projectName="Lumen" link={{ botId: chief.id, teamId: config.teamId }} />;

createRoot(document.getElementById("root")!).render(
  <StoreContext.Provider value={{ state: { ...initialState, bots: [chief] }, dispatch: (action) => { dispatched.push(action); }, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}>
    <main className="flex h-dvh min-w-0 flex-col bg-app text-ink">
      <GlassHeaderFrame className="flex min-h-0 flex-1 flex-col [--glass-tint:var(--color-app)]" barClassName="z-[25]" bar={<div className="h-2" />}>
        {page}
      </GlassHeaderFrame>
    </main>
  </StoreContext.Provider>,
);
