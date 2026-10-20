import { createRoot } from "react-dom/client";
import { useState, useSyncExternalStore } from "react";
import { ChiefSectionBar, ChiefSectionFrame } from "../../src/components/ChiefSections";
import { GlassBar, GlassHeaderFrame, GlassScrollFrame } from "../../src/components/GlassScrollFrame";
import { WorkspaceGate } from "../../src/components/origin-pages/ui";
import { WorkspaceInbox } from "../../src/components/origin-pages/WorkspaceInboxPage";
import { OrgPage } from "../../src/components/origin-org/OrgPage";
import { initialState, StoreContext, type Action, type Bot } from "../../src/state/store";
import { applySkin } from "../../src/lib/skins";
import { chiefSectionOf, chiefSectionsVersion, setChiefSectionOf, subscribeChiefSections, type ChiefSection } from "../../src/lib/origin-chief-section";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
applySkin(params.get("theme") === "light" ? "daylight" : "midnight");
const bot = (id: string, name: string, section: string, extra: Partial<Bot> = {}) => ({ id, name, title: "Chief", chiefOfStaff: true, color: "green", section, messages: [], modelSelection: { instanceId: "fixture", model: "fixture" }, threadId: `${id}-thread`, description: "", notifications: false, unread: false, ...extra }) as Bot;
const chiefs = { seed: bot("fixture-seed", "Seed", "Seed"), sketch: bot("fixture-sketch", "Sketch", "Sketch"), forge: bot("fixture-forge", "Forge", "Forge"), rocket: bot("fixture-rocket", "Rocket", "Rocket") };
const agent = bot("fixture-dev", "Kai", "Forge", { chiefOfStaff: false, title: "Developer" });
const head = bot("fixture-head", "Fixture", "Workspace: Fixture", { managedSections: ["Seed", "Sketch", "Forge", "Rocket"] });
const bots = [...Object.values(chiefs), agent, head];
const dispatched: Action[] = [];
Object.assign(window, { originJourneyDispatched: dispatched });

const chief = chiefs[(params.get("project") ?? "forge") as keyof typeof chiefs] ?? chiefs.forge;
setChiefSectionOf(chief.id, (params.get("section") as ChiefSection | null) ?? "pulse");

function Project() {
  useSyncExternalStore(subscribeChiefSections, chiefSectionsVersion);
  const section = chiefSectionOf(chief.id);
  const go = (next: ChiefSection) => setChiefSectionOf(chief.id, next);
  const navigation = <output hidden data-testid="navigation" data-section={section} data-sent={dispatched.filter((action) => action.type === "send").length} />;
  if (section !== "chat") return <><ChiefSectionFrame bot={chief} section={section} onSection={go} />{navigation}</>;
  return (
    <GlassScrollFrame className="flex-1 [--glass-tint:var(--color-app)]">
      <GlassBar edge="top" className="z-[25]"><ChiefSectionBar bot={chief} section={section} onSection={go} joined /></GlassBar>
      <div className="flex flex-col gap-3 px-5 pb-6 pt-[calc(var(--glass-top,0px)+1rem)] text-[14px] text-ink-secondary">
        <p data-testid="chat-body">Chat with {chief.name}</p>
      </div>
      {navigation}
    </GlassScrollFrame>
  );
}

const teamId = (await (await fetch("/__origin-pulse.json")).json() as { teamId: string }).teamId;

function Workspace({ view }: { view: "inbox" | "org" }) {
  return (
    <GlassHeaderFrame className="flex min-h-0 flex-1 flex-col [--glass-tint:var(--color-app)]" barClassName="z-[25]"
      bar={<header className="flex h-14 items-center px-5 text-[15px] font-semibold">{view === "inbox" ? "Inbox" : "Org"}</header>}>
      <WorkspaceGate teamId={teamId} label={view === "inbox" ? "Issues and notifications" : "The org"}>
        {(ctx) => view === "inbox" ? <WorkspaceInbox {...ctx} /> : <OrgPage {...ctx} />}
      </WorkspaceGate>
    </GlassHeaderFrame>
  );
}

const view = params.get("view");

function App() {
  const [, setTick] = useState(0);
  return (
    <StoreContext.Provider value={{ state: { ...initialState, bots }, dispatch: (action) => { dispatched.push(action); setTick((tick) => tick + 1); }, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}>
      <main className="flex h-dvh min-w-0 flex-col bg-app text-ink">{view === "inbox" || view === "org" ? <Workspace view={view} /> : <Project />}</main>
    </StoreContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
