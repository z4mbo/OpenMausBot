import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { Settings, Monitor, Palette } from "lucide-react";
import { PluginsPanel } from "/src/components/PluginsPanel";
import { SettingsModal } from "/src/components/SettingsModal";
import { TriggersPanel } from "/src/components/TriggersPanel";
import { VoiceSetupDialog } from "/src/components/VoiceSetupDialog";
import { SidebarPopoverMenu } from "/src/components/SidebarPopoverMenu";
import { initialState, StoreContext } from "/src/state/store";
import { applySkin } from "/src/lib/skins";
import { setLocale } from "/src/lib/i18n";
import { setAnalyticsEnabled } from "/src/lib/analytics";
import "/src/styles.css";

const params = new URLSearchParams(location.search);
const screen = params.get("screen") ?? "settings";
setAnalyticsEnabled(false);
setLocale("en");
applySkin(params.get("theme") === "light" ? "atelier" : "midnight");
const fixture = { marker: "origin-trigger-row-033", synthetic: true, screen, actions: [] };
window.__flatPopupFixture = fixture;
window.ogb = { platform: "win32" };
const bot = { id: "synthetic-chief", threadId: "synthetic-thread", name: params.has("long") ? "Project Chief for product design and delivery" : "Project Chief", title: "", description: "", color: "green", notifications: true, unread: false, messages: [], modelSelection: { instanceId: "synthetic-engine", model: "synthetic-model" } };
const webhook = { id: "synthetic-webhook", endpointId: "synthetic-endpoint", name: params.has("long") ? "Release planning and customer feedback collection" : "Project update", prompt: "Summarise the synthetic project update.", botId: bot.id, runOn: "maus", enabled: true, createdAt: 1, updatedAt: 1, deliveryCount: 0 };

function Fixture() {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState("general");
  const dispatch = useCallback(action => {
    fixture.actions.push(action.type);
    if (["togglePlugins", "toggleAppSettings", "toggleTriggers"].includes(action.type) && action.open === false) setOpen(false);
    if (action.type === "toggleAppSettings" && action.section) setSection(action.section);
  }, []);
  const state = { ...initialState, bots: [bot], selectedId: bot.id, appSettingsSection: section, webhooks: [webhook], webhookIngress: { available: true }, config: { ...window.__flatPopupConfig, tts: { provider: "elevenlabs", configured: true, included: true }, features: {}, engines: {} } };
  const items = [
    { key: "settings", label: "Settings", icon: <Settings size={16} />, onSelect: () => fixture.actions.push("settings-selected") },
    { key: "computer", label: "This computer", subtitle: "Synthetic local workspace", icon: <Monitor size={16} />, active: true, onSelect: () => fixture.actions.push("computer-selected") },
    { key: "appearance", label: "Appearance", icon: <Palette size={16} />, onSelect: () => {}, submenu: [
      { key: "light", label: "Light", active: true, onSelect: () => fixture.actions.push("light-selected") },
      { key: "dark", label: "Dark", onSelect: () => fixture.actions.push("dark-selected") },
    ] },
    { key: "unavailable", label: "Unavailable in fixture", disabled: true, onSelect: () => fixture.actions.push("disabled-selected") },
  ];
  return <StoreContext.Provider value={{ state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}>
    <main data-flat-popup-fixture={fixture.marker} className="flex min-h-dvh flex-col bg-app text-ink">
      <header className="flex flex-wrap items-center gap-2 border-b border-hairline p-4">
        <button type="button" className="ui-button" data-fixture-opener onClick={() => setOpen(true)}>Open {screen}</button>
        <button type="button" className="ui-button" data-background-action>Background action</button>
      </header>
      <p className="px-4 py-2 text-[13px] text-ink-secondary">Isolated production components · synthetic state</p>
      {open && screen === "settings" && <SettingsModal />}
      {open && screen === "apps" && <PluginsPanel />}
      {open && screen === "triggers" && <TriggersPanel />}
      {open && screen === "voice" && <VoiceSetupDialog bot={bot} callName={bot.name} ready onClose={() => setOpen(false)} onStartCall={() => fixture.actions.push("synthetic-call-selected")} />}
      {screen.startsWith("menu") && <div style={screen === "menu-inline" ? { marginLeft: "auto", marginRight: 16, marginTop: 16, width: 160 } : { position: "fixed", bottom: 32, left: 16, width: 160 }}>
        <SidebarPopoverMenu items={items} ariaLabel="Workspace options" placement={screen === "menu-inline" ? "below" : "above"} triggerClassName="ui-button" renderTrigger={() => "Workspace options"} />
      </div>}
    </main>
  </StoreContext.Provider>;
}
createRoot(document.getElementById("root")).render(<Fixture />);
