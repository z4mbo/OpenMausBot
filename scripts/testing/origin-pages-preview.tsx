import { useState } from "react";
import { createRoot } from "react-dom/client";
import { initialState, StoreContext } from "../../src/state/store";
import { applySkin } from "../../src/lib/skins";
import { setSessionToken } from "../../src/lib/origin-cloud/client";
import { AssetsPage } from "../../src/components/origin-pages/AssetsPage";
import { FeedbackPage } from "../../src/components/origin-pages/FeedbackPage";
import { IssuesPage } from "../../src/components/origin-pages/IssuesPage";
import { VaultPage } from "../../src/components/origin-pages/VaultPage";
import { RepoPage } from "../../src/components/origin-pages/RepoPage";
import { ProjectSettingsPage } from "../../src/components/origin-pages/ProjectSettingsPage";
import { WorkspaceInbox } from "../../src/components/origin-pages/WorkspaceInboxPage";
import { WorkspaceChat } from "../../src/components/origin-pages/WorkspaceChatPage";
import { GlassHeaderFrame } from "../../src/components/GlassScrollFrame";
import { WorkspaceMembersPanel } from "../../src/components/origin-members/WorkspaceMembers";
import { OriginAccountMenu } from "../../src/components/OriginAccountMenu";
import { fixtureMe } from "./origin-pages-cloud";
import { encryptSecret } from "../../src/components/origin-pages/vaultCrypto";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
applySkin(params.get("theme") === "light" ? "atelier" : "midnight");
setSessionToken("origin-pages-isolated-fixture");
if (!["empty", "loading"].includes(params.get("state") ?? "")) {
  const encrypted = await encryptSecret("synthetic-secret-value", "fixture-passphrase");
  (window as unknown as { originPagesFixture: { setQuery(name: string, value: unknown): void } }).originPagesFixture.setQuery("credentials:list", [{ _id: "fixture-credential", title: "Synthetic API credential", kind: "api_key", username: "fixture-account", ...encrypted, updatedAt: Date.now() }]);
}
function Fixture() {
  const [projectId, setProjectId] = useState("fixture-project");
  const props = { cloudProjectId: projectId, projectName: "Fixture project" };
  const workspace = { teamId: "fixture-team", me: fixtureMe, canEdit: params.get("role") !== "viewer", isAdmin: params.get("role") !== "viewer", role: params.get("role") === "viewer" ? "viewer" as const : "owner" as const };
  const screen = params.get("screen") ?? "issues";
  const pages: Record<string, React.ReactNode> = {
    issues: <IssuesPage {...props} />, assets: <AssetsPage {...props} />, vault: <VaultPage {...props} />, feedback: <FeedbackPage {...props} />,
    repo: <RepoPage {...props} />, settings: <ProjectSettingsPage {...props} />, inbox: <WorkspaceInbox {...workspace} />, chat: <WorkspaceChat {...workspace} />,
    members: <div className="min-w-0 flex-1 overflow-y-auto pt-[var(--glass-top,0px)]"><WorkspaceMembersPanel cloudTeamId={projectId === "fixture-project" ? "fixture-team" : "fixture-other-team"} /></div>,
    account: <div className="min-w-0 flex-1 p-4 pt-[calc(var(--glass-top,0px)+1rem)]"><div className="w-64 max-w-full"><OriginAccountMenu /></div></div>,
  };
  return <main className="flex h-dvh min-w-0 flex-col bg-app text-ink"><GlassHeaderFrame className="flex min-w-0 flex-1 flex-col" bar={<div className="flex items-center gap-2 px-4 py-3 text-sm"><span className="min-w-0 flex-1 truncate">{projectId === "fixture-project" ? "Fixture project" : "Other fixture project"}</span><button className="rounded-md px-2 py-1 hover:bg-raised" onClick={() => setProjectId((id) => id === "fixture-project" ? "fixture-other-project" : "fixture-project")}>Switch project</button></div>}>{pages[screen]}</GlassHeaderFrame></main>;
}
createRoot(document.getElementById("root")!).render(<StoreContext.Provider value={{ state: initialState, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}><Fixture /></StoreContext.Provider>);
