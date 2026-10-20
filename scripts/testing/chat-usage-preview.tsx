import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatView } from "../../src/components/ChatView";
import { DesktopCapabilitiesProvider } from "../../src/components/DesktopCapabilities";
import { ThreadRefsProvider } from "../../src/components/ThreadRefs";
import { StoreProvider, useStore } from "../../src/state/store";
import { setCloudUrl } from "../../src/lib/origin-cloud";
import { applyChatWidth, readChatWidth } from "../../src/lib/chat-width";
import { applySkin } from "../../src/lib/skins";
import { setLocale } from "../../src/lib/i18n";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
setLocale("en"); setCloudUrl(null);
applySkin(params.get("theme") === "light" ? "atelier" : "midnight"); applyChatWidth(readChatWidth());

function Fixture() {
  const { state } = useStore();
  const [unavailable, setUnavailable] = useState(false);
  const bot = state.bots[0];
  return <div className="flex h-dvh min-w-0 flex-col overflow-hidden bg-app text-ink">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline/40 px-4 py-2 text-[12px] text-ink-secondary">
      <span>Isolated ChatView · fake CLI/context · synthetic quota</span>
      <button type="button" className="rounded px-2 py-1 hover:bg-control" onClick={() => { void fetch("/__fixture/chat-usage/availability", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ unavailable: !unavailable }) }).then(() => setUnavailable(!unavailable)); }}>Show {unavailable ? "available" : "unavailable"} quota, then refresh panel</button>
    </div>
    {!bot ? <p role="status" className="p-4">Loading the disposable conversation…</p> : <ChatView bot={bot} />}
  </div>;
}
const root = createRoot(document.getElementById("root")!);
root.render(<DesktopCapabilitiesProvider><StoreProvider><ThreadRefsProvider><Fixture /></ThreadRefsProvider></StoreProvider></DesktopCapabilitiesProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
