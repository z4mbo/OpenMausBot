import { createRoot } from "react-dom/client";
import { useState, useSyncExternalStore } from "react";
import { CircleDot, FileText, Rocket } from "lucide-react";
import { IssuesPage } from "../../src/components/origin-pages/IssuesPage";
import { DocsPage } from "../../src/components/origin-docs/DocsPage";
import { LaunchpadDialog } from "../../src/components/origin-launchpad/LaunchpadDialog";
import { initialState, StoreContext, type Action, type Bot } from "../../src/state/store";
import { applySkin } from "../../src/lib/skins";
import { chiefSectionOf, chiefSectionsVersion, setChiefSectionOf, subscribeChiefSections } from "../../src/lib/origin-chief-section";
import { setMilestoneFilter } from "../../src/lib/origin-milestone-filter";
import "../../src/styles.css";

const config = await (await fetch("/__origin-launchpad.json")).json() as { projects: Record<"walkies" | "empty", string> };
const params = new URLSearchParams(location.search);
applySkin(params.get("theme") === "light" ? "daylight" : "midnight");
const which = params.get("project") === "empty" ? "empty" : "walkies";
const projectId = config.projects[which];
const projectName = which === "empty" ? "Empty idea" : "Walkies";
const chief = { id: "fixture-chief", name: "Atlas", title: "Project lead", chiefOfStaff: true, color: "green", section: projectName, messages: [], modelSelection: { instanceId: "fixture", model: "fixture" }, threadId: "fixture-thread", description: "", notifications: false, unread: false } as Bot;
setChiefSectionOf(chief.id, params.get("section") === "docs" ? "docs" : "issues");
const dispatched: Action[] = [];
Object.assign(window, { originLaunchpadDispatched: dispatched });

const tab = "flex h-9 items-center gap-2 rounded-xl px-2.5 text-[13.5px] font-medium";

function Shell() {
  useSyncExternalStore(subscribeChiefSections, chiefSectionsVersion);
  const section = chiefSectionOf(chief.id);
  const [launch, setLaunch] = useState<"new" | "project" | null>(null);
  return (
    <main className="flex h-dvh min-w-0 flex-col bg-app text-ink">
      <nav aria-label="Fixture sections" className="flex shrink-0 items-center gap-1 border-b border-hairline/40 px-3 py-2" data-testid="navigation" data-section={section}>
        <button type="button" className={`${tab} ${section === "issues" ? "bg-raised text-ink" : "text-ink-secondary"}`} onClick={() => setChiefSectionOf(chief.id, "issues")}><CircleDot size={18} />Issues</button>
        <button type="button" className={`${tab} ${section === "docs" ? "bg-raised text-ink" : "text-ink-secondary"}`} onClick={() => setChiefSectionOf(chief.id, "docs")}><FileText size={18} />Docs</button>
        <button type="button" className={`${tab} ml-auto text-ink-secondary`} onClick={() => setLaunch("new")}><Rocket size={18} />New project</button>
      </nav>
      {section === "docs"
        ? <DocsPage cloudProjectId={projectId} projectName={projectName} onLaunch={() => setLaunch("project")}
          onOpenMilestone={(milestoneId) => { setMilestoneFilter(projectId, milestoneId); setChiefSectionOf(chief.id, "issues"); }} />
        : <IssuesPage cloudProjectId={projectId} projectName={projectName} agents={[]} onLaunch={() => setLaunch("project")} />}
      {launch && <LaunchpadDialog target={launch === "new" ? { kind: "new" } : { kind: "project", chief, projectName }} onClose={() => setLaunch(null)} />}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StoreContext.Provider value={{ state: initialState, dispatch: (action) => { dispatched.push(action); }, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}>
    <Shell />
  </StoreContext.Provider>,
);
