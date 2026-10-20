import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DrawingCanvas } from "../../src/components/origin-pages/DrawingCanvas";
import { ProjectDrawPage } from "../../src/components/OriginDraw";
import { initialState, StoreContext, type Bot } from "../../src/state/store";
import { applySkin } from "../../src/lib/skins";
import "../../src/styles.css";
const params = new URLSearchParams(location.search);
applySkin(params.get("theme") === "light" ? "daylight" : "midnight");
const chief = { id: "fixture-chief", name: "Atlas", title: "Chief", chiefOfStaff: true, color: "green", section: "Fixture project", messages: [], modelSelection: { instanceId: "fixture", model: "fixture" }, threadId: "fixture-thread", description: "", notifications: false, unread: false } as Bot;
const sent: unknown[] = [];
Object.assign(window, { originCanvasSent: sent });
function Fixture() {
  const [open, setOpen] = useState(true);
  return <main className="flex h-dvh min-w-0 flex-col bg-app text-ink">
    <div className="flex shrink-0 gap-2 border-b border-hairline px-3 py-2 text-xs">
      <button onClick={() => setOpen(!open)}>{open ? "Leave canvas" : "Return to canvas"}</button>
    </div>
    {open ? params.has("project") ? <ProjectDrawPage agent={chief} cloudProjectId="fixture-project" projectName="Fixture project" /> : <DrawingCanvas teamId="fixture-team" canvasId="fixture-canvas" projectId="fixture-project" userId="fixture-user" name="Release planning" agent={chief} readOnly={params.has("viewer")} /> : <p className="p-4 text-sm">Canvas closed</p>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<StoreContext.Provider value={{ state: initialState, dispatch: (action: unknown) => { sent.push(action); }, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}><Fixture /></StoreContext.Provider>);
