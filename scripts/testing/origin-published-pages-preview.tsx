import { createRoot } from "react-dom/client";
import { ProjectDrawPage } from "../../src/components/OriginDraw";
import { initialState, StoreContext, type Bot } from "../../src/state/store";
import { applySkin } from "../../src/lib/skins";
import "../../src/styles.css";

const config = await (await fetch("/__origin-campaigns.json")).json() as { projectId: string };
applySkin(new URLSearchParams(location.search).get("theme") === "light" ? "daylight" : "midnight");
const chief = { id: "fixture-chief", name: "Atlas", title: "Chief", chiefOfStaff: true, color: "green", section: "Launch", messages: [], modelSelection: { instanceId: "fixture", model: "fixture" }, threadId: "fixture-thread", description: "", notifications: false, unread: false } as Bot;

createRoot(document.getElementById("root")!).render(
  <StoreContext.Provider value={{ state: initialState, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}>
    <main className="flex h-dvh min-w-0 flex-col bg-app text-ink">
      <ProjectDrawPage agent={chief} cloudProjectId={config.projectId} projectName="Launch" />
    </main>
  </StoreContext.Provider>,
);
