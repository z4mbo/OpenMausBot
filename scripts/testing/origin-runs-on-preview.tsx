import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ChatView } from "../../src/components/ChatView";
import { RunsOnCard } from "../../src/components/bot-settings/RunsOnCard";
import { DesktopCapabilitiesProvider } from "../../src/components/DesktopCapabilities";
import { ThreadRefsProvider } from "../../src/components/ThreadRefs";
import { StoreProvider, useStore, type Bot } from "../../src/state/store";
import { applySkin } from "../../src/lib/skins";
import { setLocale } from "../../src/lib/i18n";
import "../../src/styles.css";

const fixture = await (await fetch("/__origin-cloud.json")).json() as { agentId: string; teamId: string };
setLocale("en");
applySkin(new URLSearchParams(location.search).get("theme") === "light" ? "atelier" : "midnight");

function Fixture() {
  const { state, dispatch } = useStore();
  const found = state.bots.find((bot) => bot.name === "Planner");
  useEffect(() => { if (found) dispatch({ type: "select", id: found.id }); }, [found?.id, dispatch]);
  if (!found) return <p role="status">Loading disposable agent…</p>;
  const bot: Bot = { ...found, shared: { agentId: fixture.agentId, teamId: fixture.teamId, canEdit: true } };
  return (
    <div className="flex h-dvh min-w-0 bg-app text-ink">
      <div className="flex min-w-0 flex-1 flex-col" data-testid="runs-on-chat"><ChatView bot={bot} /></div>
      <aside className="w-[380px] shrink-0 overflow-y-auto border-l border-hairline/40 bg-app p-4" data-testid="runs-on-settings"><RunsOnCard bot={bot} /></aside>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<DesktopCapabilitiesProvider><StoreProvider><ThreadRefsProvider><Fixture /></ThreadRefsProvider></StoreProvider></DesktopCapabilitiesProvider>);
