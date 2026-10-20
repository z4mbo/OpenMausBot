import { createRoot } from "react-dom/client";
import { useSyncExternalStore } from "react";
import { ShipPage } from "../../src/components/origin-ship/ShipPage";
import { OriginPullRequestCard } from "../../src/components/OriginPullRequestCard";
import { GlassHeaderFrame } from "../../src/components/GlassScrollFrame";
import { initialState, StoreContext, type Action, type Bot, type Message } from "../../src/state/store";
import { applySkin } from "../../src/lib/skins";
import { chiefSectionOf, chiefSectionsVersion, subscribeChiefSections } from "../../src/lib/origin-chief-section";
import "../../src/styles.css";

const config = await (await fetch("/__origin-ship.json")).json() as { projectId: string };
const params = new URLSearchParams(location.search);
applySkin(params.get("theme") === "light" ? "daylight" : "midnight");
const chief = { id: "fixture-chief", name: "Atlas", title: "Chief", chiefOfStaff: true, color: "green", section: "Launch", messages: [], modelSelection: { instanceId: "fixture", model: "fixture" }, threadId: "fixture-thread", description: "", notifications: false, unread: false } as Bot;
const dispatched: Action[] = [];
Object.assign(window, { originShipDispatched: dispatched });

const card: Message = {
  id: "pr-card", at: Date.now(), role: "bot", kind: "activity", tool: { name: "origin_review_pr", ok: true },
  originPullRequest: {
    projectId: config.projectId, projectName: "Launch", number: 42, title: "Dark mode for the dashboard", url: "https://github.com/acme/launch/pull/42", state: "open",
    author: "ada", branch: "dark-mode", baseBranch: "main", headSha: "9f3c2a1".padEnd(40, "0"), additions: 214, deletions: 37, files: 9, checks: "success", review: "approved", mergeable: true, closes: ["ORI-7Q2X"],
  },
} as Message;

function Navigation() {
  useSyncExternalStore(subscribeChiefSections, chiefSectionsVersion);
  return <output hidden data-testid="navigation" data-section={chiefSectionOf(chief.id)} />;
}

createRoot(document.getElementById("root")!).render(
  <StoreContext.Provider value={{ state: initialState, dispatch: (action) => { dispatched.push(action); }, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}>
    <main className="flex h-dvh min-w-0 flex-col bg-app text-ink">
      {params.has("card") ? (
        <div className="flex flex-1 flex-col items-start gap-3 p-4" data-testid="chat-card"><OriginPullRequestCard message={card} /></div>
      ) : (
        <GlassHeaderFrame className="flex min-h-0 flex-1 flex-col [--glass-tint:var(--color-app)]" barClassName="z-[25]" bar={<div className="h-2" />}>
          <ShipPage agent={chief} cloudProjectId={config.projectId} projectName="Launch" />
        </GlassHeaderFrame>
      )}
      <Navigation />
    </main>
  </StoreContext.Provider>,
);
