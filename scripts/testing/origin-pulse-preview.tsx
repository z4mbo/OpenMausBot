import { createRoot } from "react-dom/client";
import { useSyncExternalStore } from "react";
import { PulsePage } from "../../src/components/origin-pulse/PulsePage";
import { OrgPage } from "../../src/components/origin-org/OrgPage";
import { initialState, StoreContext, type Action, type Bot } from "../../src/state/store";
import { applySkin } from "../../src/lib/skins";
import { chiefSectionOf, chiefSectionsVersion, subscribeChiefSections } from "../../src/lib/origin-chief-section";
import "../../src/styles.css";

const config = await (await fetch("/__origin-pulse.json")).json() as { teamId: string; rocket: string; notes: string };
const params = new URLSearchParams(location.search);
applySkin(params.get("theme") === "light" ? "daylight" : "midnight");
const bot = (id: string, name: string, section: string) => ({ id, name, title: "Chief", chiefOfStaff: true, color: "green", section, messages: [], modelSelection: { instanceId: "fixture", model: "fixture" }, threadId: `${id}-thread`, description: "", notifications: false, unread: false }) as Bot;
const bots = [bot("fixture-rocket", "Atlas", "Rocket"), bot("fixture-apollo", "Iris", "Apollo")];
const dispatched: Action[] = [];
Object.assign(window, { originPulseDispatched: dispatched });

/** Where a Pulse link sent the person: the section each project's Chief now shows. */
function Navigation() {
  useSyncExternalStore(subscribeChiefSections, chiefSectionsVersion);
  return <output hidden data-testid="navigation" data-rocket={chiefSectionOf("fixture-rocket")} data-apollo={chiefSectionOf("fixture-apollo")} />;
}

const me = { _id: "fixture-user", name: "ada", email: "ada@fixture.test" };
const view = params.get("view") ?? "project";
const project = params.get("project") === "notes" ? config.notes : config.rocket;

createRoot(document.getElementById("root")!).render(
  <StoreContext.Provider value={{ state: { ...initialState, bots }, dispatch: (action) => { dispatched.push(action); }, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}>
    <main className="flex h-dvh min-w-0 flex-col bg-app text-ink">
      {view === "workspace"
        ? <OrgPage teamId={config.teamId} me={me as never} role="owner" canEdit />
        : <PulsePage botId="fixture-rocket" cloudProjectId={project} projectName={project === config.notes ? "Notes" : "Rocket"} />}
      <Navigation />
    </main>
  </StoreContext.Provider>,
);
