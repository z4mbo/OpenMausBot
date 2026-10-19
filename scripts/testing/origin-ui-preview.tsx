import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CenteredDialog } from "../../src/components/CenteredDialog";
import { ChipSelect, DateChip } from "../../src/components/origin-pages/issue-fields";
import { Modal, primaryButton } from "../../src/components/origin-pages/ui";
import { TeamChat } from "../../src/components/origin-pages/TeamChatPage";
import { WhatsNew } from "../../src/components/WhatsNew";
import { AssignIssueDialog } from "../../src/components/origin-pages/AssignIssueDialog";
import { OriginConnectDialog } from "../../src/components/OriginConnect";
import { WorkspaceSwitcher } from "../../src/components/SidebarProjects";
import { initialState, StoreContext, type Bot, type Message } from "../../src/state/store";
import { ChiefSectionFrame } from "../../src/components/ChiefSections";
import { OriginSearch } from "../../src/components/OriginSearch";
import { DelegationBlock } from "../../src/components/DelegationBlock";
import type { ChiefSection } from "../../src/lib/origin-chief-section";
import { applySkin } from "../../src/lib/skins";
import { setSessionToken } from "../../src/lib/origin-cloud/client";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
applySkin(params.get("theme") === "light" ? "atelier" : "midnight");
setSessionToken("origin-ui-isolated-fixture");

const fixtureBot = (id: string, name: string, extra: Partial<Bot> = {}): Bot => ({ id, name, title: "Developer", color: "green", messages: [], notifications: false, unread: false, modelSelection: { instanceId: "fixture", model: "fixture" }, threadId: `thread-${id}`, description: "", section: "Fixture project", ...extra });
const fixtureLead = fixtureBot("fixture-chief", "Fixture project with a long title", { chiefOfStaff: true, title: "Chief" });
const fixtureAgent = fixtureBot("fixture-developer", "Fixture developer with a very long name", { messages: [{ id: "fixture-message", kind: "text", role: "bot", text: "The synthetic project is ready for inspection.", at: 1 }] });
const fixtureHead = fixtureBot("fixture-head", "Fixture workspace", { chiefOfStaff: true, section: "Workspace: Fixture", managedSections: ["Fixture project"] });
const fixtureSent: Message = { id: "fixture-sent", kind: "activity", role: "bot", text: "Delegated work", at: 1, roomRequest: { id: "fixture-request", phase: "sent" }, threadRef: { botId: fixtureAgent.id, threadId: "fixture-delegation", title: "Inspect the release flow" } };

function Fixture() {
  const screen = params.get("screen") ?? "issue";
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("medium");
  const [busy, setBusy] = useState(false);
  const [nested, setNested] = useState(false);
  const [assigned, setAssigned] = useState("");
  const [section, setSection] = useState<ChiefSection>((params.get("section") as ChiefSection | null) ?? "agents");
  if (screen === "project") return <main className="flex h-dvh min-w-0 flex-col bg-app text-ink"><ChiefSectionFrame bot={fixtureLead} section={section === "chat" ? "agents" : section} onSection={setSection} /></main>;
  if (screen === "delegation") return <main className="min-h-dvh bg-app p-4 text-ink"><DelegationBlock sent={fixtureSent} agent={fixtureAgent} failed={false}
    renderTranscript={(messages) => <div>{messages.map((message) => <p key={message.id} className="text-sm">{message.text}</p>)}</div>} /></main>;
  if (screen === "search") return <main className="min-h-dvh bg-app p-4 text-ink"><button className={primaryButton} onClick={() => setOpen(true)}>Open search</button>{open && <OriginSearch onClose={() => setOpen(false)} />}</main>;
  if (screen === "whatsnew") return <main className="min-h-dvh bg-app p-4 text-ink"><WhatsNew /></main>;
  if (["assign", "connect", "members"].includes(screen)) return <main className="min-h-dvh bg-app p-4 text-ink">
    <button className={primaryButton} onClick={() => setOpen(true)}>Open {screen}</button>
    <button className={`${primaryButton} ml-2`}>Outside action</button>
    {assigned && <p role="status">Assigned to {assigned}</p>}
    {screen === "members" && <div className="relative mt-4 h-14 w-64 rounded-lg border border-hairline px-4 py-3">Fixture workspace<WorkspaceSwitcher heads={[]} onNewWorkspace={() => {}} /></div>}
    {open && screen === "assign" && <AssignIssueDialog issue={{ id: "fixture", key: "ORI-1", projectId: "fixture", projectName: "Fixture", title: "Verify the assignment dialog", priority: "medium", labels: [], status: "Draft" }}
      agents={[{ id: "fixture-agent", name: "Fixture developer", title: "Developer", color: "green", messages: [], notifications: false, unread: false, modelSelection: {}, threadId: "fixture-thread", description: "" } as Bot]}
      onPick={(agent) => { setAssigned(agent.name); setOpen(false); }} onClose={() => setOpen(false)} />}
    {open && screen === "connect" && <OriginConnectDialog onClose={() => setOpen(false)} />}
  </main>;
  if (screen === "chat") return <main className="flex h-dvh min-w-0 flex-col bg-app text-ink">
    <TeamChat target={{ teamId: "fixture", conversation: "project:fixture" }} me={{ _id: "me", email: "me@example.test", name: "Fixture user" }} name="Fixture project" canWrite people={[]}
      emptyTitle="Fixture chat" emptyBody="Synthetic messages only" readOnlyNote="Read only" />
  </main>;
  return <main className="min-h-dvh bg-app p-4 text-ink">
    <h1 className="mb-4 text-lg font-semibold">Origin isolated UI verification</h1>
    <button className={primaryButton} onClick={() => setOpen(true)}>Open {screen}</button>
    {open && (screen === "modal" ? <Modal title="Asset editor" onClose={() => setOpen(false)} canClose={() => !busy}>
      <label className="flex flex-col gap-2 text-sm">Asset name<input className="rounded-lg border border-hairline bg-inset p-2" defaultValue="Synthetic asset" /></label>
      <button className={`${primaryButton} mt-4`} onClick={() => setBusy((current) => !current)}>{busy ? "Finish saving" : "Start saving"}</button>
      <button className={`${primaryButton} mt-4`} onClick={() => setNested(true)}>Open confirmation</button>
      {nested && <CenteredDialog label="Confirm asset" onClose={() => setNested(false)} className="sm:max-w-sm">{(dismiss) => <button onClick={dismiss}>Keep asset</button>}</CenteredDialog>}
    </Modal> : <CenteredDialog label="New issue" onClose={() => setOpen(false)} className="sm:max-w-[780px]">
      {(dismiss) => <div className="p-5">
        <div className="mb-4 flex items-center"><h2 className="flex-1 font-medium">New issue</h2><button onClick={dismiss}>Close</button></div>
        <textarea aria-label="Issue title" placeholder="Issue title" className="w-full bg-transparent text-xl outline-none" />
        <textarea aria-label="Issue description" placeholder="Add a description…" className="min-h-36 w-full bg-transparent text-sm outline-none" />
        <div className="flex flex-wrap gap-2">
          <ChipSelect label="Status" value="draft" options={[{ value: "draft", label: "Draft", hint: "Not on GitHub" }]} onChange={() => {}} />
          <ChipSelect label="Priority" value={value} options={[{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }]} onChange={setValue} />
          <ChipSelect label="Assignee" value="me" options={[{ value: "me", label: "Fixture person" }]} onChange={() => {}} />
          <DateChip value="2026-10-23" onChange={() => {}} />
        </div>
      </div>}
    </CenteredDialog>)}
  </main>;
}

createRoot(document.getElementById("root")!).render(<StoreContext.Provider value={{ state: { ...initialState, bots: [fixtureHead, fixtureLead, fixtureAgent] }, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}><Fixture /></StoreContext.Provider>);
