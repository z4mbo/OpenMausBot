import { createRoot } from "react-dom/client";
import { useState } from "react";
import { CircleDot, Rocket } from "lucide-react";
import { IssuesPage } from "../../src/components/origin-pages/IssuesPage";
import { LaunchpadDialog } from "../../src/components/origin-launchpad/LaunchpadDialog";
import { initialState, StoreContext, type Action, type Bot } from "../../src/state/store";
import { applySkin } from "../../src/lib/skins";
import "../../src/styles.css";

const config = await (await fetch("/__origin-launchpad.json")).json() as { projects: Record<"walkies" | "empty", string> };
const params = new URLSearchParams(location.search);
applySkin(params.get("theme") === "light" ? "daylight" : "midnight");
const which = params.get("project") === "empty" ? "empty" : "walkies";
const projectId = config.projects[which];
const projectName = which === "empty" ? "Empty idea" : "Walkies";
const chief = { id: "fixture-chief", name: "Atlas", title: "Project lead", chiefOfStaff: true, color: "green", section: projectName, messages: [], modelSelection: { instanceId: "fixture", model: "fixture" }, threadId: "fixture-thread", description: "", notifications: false, unread: false } as Bot;
const dispatched: Action[] = [];
Object.assign(window, { originLaunchpadDispatched: dispatched });

const tab = "flex h-9 items-center gap-2 rounded-xl px-2.5 text-[13.5px] font-medium";

function Shell() {
  const [launch, setLaunch] = useState<"new" | "project" | null>(null);
  return (
    <main className="flex h-dvh min-w-0 flex-col bg-app text-ink">
      <nav aria-label="Fixture sections" className="flex shrink-0 items-center gap-1 border-b border-hairline/40 px-3 py-2" data-testid="navigation">
        <span className={`${tab} bg-raised text-ink`}><CircleDot size={18} />Issues</span>
        <button type="button" className={`${tab} ml-auto text-ink-secondary`} onClick={() => setLaunch("new")}><Rocket size={18} />New project</button>
      </nav>
      <IssuesPage cloudProjectId={projectId} projectName={projectName} agents={[]} onLaunch={() => setLaunch("project")} />
      {launch && <LaunchpadDialog target={launch === "new" ? { kind: "new" } : { kind: "project", chief, projectName }} onClose={() => setLaunch(null)} />}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StoreContext.Provider value={{ state: initialState, dispatch: (action) => { dispatched.push(action); }, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}>
    <Shell />
  </StoreContext.Provider>,
);
