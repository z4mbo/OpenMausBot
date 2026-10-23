import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ChatView } from "../../src/components/ChatView";
import { ProjectAgentsPage } from "../../src/components/ProjectAgentsPage";
import { DesktopCapabilitiesProvider } from "../../src/components/DesktopCapabilities";
import { ThreadRefsProvider } from "../../src/components/ThreadRefs";
import { StoreProvider, useStore, type Bot } from "../../src/state/store";
import { openNotificationTarget } from "../../src/state/thread-navigation";
import { setCloudUrl } from "../../src/lib/origin-cloud";
import { useChiefSection } from "../../src/components/ChiefSections";
import { setChiefSectionOf } from "../../src/lib/origin-chief-section";
import { applySkin } from "../../src/lib/skins";
import { setLocale } from "../../src/lib/i18n";
import "../../src/styles.css";

setLocale("en"); setCloudUrl(null);
applySkin(new URLSearchParams(location.search).get("theme") === "light" ? "atelier" : "midnight");
function Project({ lead }: { lead: Bot }) {
  const { state, dispatch } = useStore();
  const [section, setSection] = useChiefSection(lead.id);
  useEffect(() => { setChiefSectionOf(lead.id, "agents"); dispatch({ type: "select", id: lead.id }); }, [lead.id, dispatch]);
  const researcher = state.bots.find(bot => bot.name === "Researcher");
  const linked = researcher?.tasks?.find(task => task.openedBy?.botId === lead.id);
  return <div className="flex h-dvh min-w-0 flex-col overflow-hidden bg-app text-ink">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline/40 px-3 py-2 text-[12px] text-ink-secondary">
      <span>Isolated agent conversations · actual coordinator · fake CLI</span>
      <button type="button" onClick={() => setSection("agents")}>Agents</button>
      {researcher && linked && <button type="button" onClick={() => openNotificationTarget(dispatch, { botId: researcher.id, threadId: linked.threadId }, state, true)}>Open delegated notification</button>}
      <output aria-label="Selected project">{state.selectedId === lead.id ? "Project stays selected" : "Another bot selected"}</output>
    </div>
    {section === "agents" ? <ProjectAgentsPage lead={lead} agents={state.bots.filter(bot => bot.id !== lead.id && bot.section === lead.section)} /> : <ChatView bot={lead} />}
  </div>;
}
function Fixture() {
  const { state } = useStore();
  const lead = state.bots.find(bot => bot.chiefOfStaff);
  return lead ? <Project lead={lead} /> : <p role="status">Loading disposable project…</p>;
}
const root = createRoot(document.getElementById("root")!);
root.render(<DesktopCapabilitiesProvider><StoreProvider><ThreadRefsProvider><Fixture /></ThreadRefsProvider></StoreProvider></DesktopCapabilitiesProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
