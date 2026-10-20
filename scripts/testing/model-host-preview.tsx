import { useReducer, useState, type Dispatch } from "react";
import { createRoot } from "react-dom/client";
import { CloudProvider, setCloudUrl } from "../../src/lib/origin-cloud";
import { setSessionToken } from "../../src/lib/origin-cloud/client";
import { StoreContext, api, currentTaskBot, initialState, reducer, type Action, type Bot, type InstanceInfo } from "../../src/state/store";
import { ModelPicker } from "../../src/components/ModelPicker";
import { ModelSection } from "../../src/components/bot-settings/ModelSection";
import { ProviderConnectionsSettings } from "../../src/components/ProviderConnectionsSettings";
import { applySkin } from "../../src/lib/skins";
import { setLocale } from "../../src/lib/i18n";
import "../../src/styles.css";

type Bootstrap = { url: string; sessionToken: string; bot: Bot; profiles: InstanceInfo[] };
const params = new URLSearchParams(location.search), screen = params.get("screen") ?? "chat", theme = params.get("theme") === "light" ? "light" : "dark";
setLocale("en"); applySkin(theme === "light" ? "atelier" : "midnight");

function Fixture({ data }: { data: Bootstrap }) {
  const [state, rawDispatch] = useReducer(reducer, { ...initialState, bots: [data.bot], instances: data.profiles });
  const [error, setError] = useState("");
  const [control, setControl] = useState("");
  const dispatch: Dispatch<Action> = action => {
    if (action.type === "setModel") {
      void api<{ bot: Bot }>(`/api/bots/${action.botId}/tasks/${action.threadId ?? data.bot.threadId}`, { method: "PATCH", body: JSON.stringify({ modelSelection: action.selection, updateBotDefault: action.updateBotDefault }) })
        .then(result => rawDispatch({ type: "botPatched", bot: result.bot })).catch(cause => setError(cause instanceof Error ? cause.message : "Synthetic selection failed"));
      return;
    }
    rawDispatch(action);
  };
  const bot = state.bots[0];
  const sendControl = (body: unknown, message: string) => void api("/__fixture/model-host-ui/control", { method: "POST", body: JSON.stringify(body) }).then(() => setControl(message));
  return <StoreContext value={{ state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}><main className="min-h-dvh min-w-0 bg-app p-4 text-ink sm:p-8"><div className="mx-auto grid w-full max-w-[900px] min-w-0 gap-4">
    <header className="border-b border-hairline/40 pb-3"><p className="text-[12px] text-ink-secondary">Isolated shared model UI · synthetic catalog</p><h1 className="mt-1 text-[20px] font-medium">Shared model accounts</h1><nav className="mt-3 flex flex-wrap gap-3 text-[13px]">{["chat", "agent", "connections"].map(value => <a key={value} className="rounded px-2 py-1 text-ink-secondary hover:bg-control" href={`?screen=${value}&theme=${theme}`}>{value === "chat" ? "Model picker" : value === "agent" ? "Agent backups" : "Owner sharing"}</a>)}</nav></header>
    {screen === "connections" ? <ProviderConnectionsSettings /> : screen === "agent" ? <ModelSection key={bot.id} bot={bot} /> : <section className="rounded-xl border border-hairline/40 bg-panel p-3"><div className="@container/chathead flex min-w-0 items-center justify-between gap-3"><h2 className="text-[15px] font-medium">{bot.name}</h2><ModelPicker key={bot.threadId} bot={currentTaskBot(bot)} threadId={bot.threadId} /></div><div className="min-h-80 p-4 text-[13px] text-ink-secondary">Select Shared accounts in the model picker. This fixture never runs a model.</div></section>}
    {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    <details className="text-[12px] text-ink-secondary"><summary>Verification controls and scope</summary><p className="mt-2 leading-relaxed">Actual UI components, reducer and HTTP calls. Catalog, grant persistence and model changes are controlled synthetic handlers; workspace/project names use the isolated native backend. No real host is enabled, no provider runs, and no production data is used.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className="ui-button" onClick={() => sendControl({ failNext: true }, "Next save fails once.")}>Fail next save</button><button type="button" className="ui-button" onClick={() => sendControl({ offline: true }, "Sources offline; refresh the list.")}>Sources offline</button><button type="button" className="ui-button" onClick={() => sendControl({ offline: false }, "Sources online; refresh the list.")}>Sources online</button><button type="button" className="ui-button" onClick={() => sendControl({ ready: false }, "Hosting held; refresh the owner settings or picker.")}>Hold hosting</button><button type="button" className="ui-button" onClick={() => sendControl({ ready: true }, "Prepared UI enabled in this synthetic fixture only.")}>Show prepared UI</button></div><p role="status" className="mt-2">{control}</p></details>
  </div></main></StoreContext>;
}

const root = createRoot(document.getElementById("root")!);
void fetch("/__fixture/model-host-ui/bootstrap").then(response => response.json()).then((data: Bootstrap) => { setCloudUrl(data.url); setSessionToken(data.sessionToken); root.render(<CloudProvider><Fixture data={data} /></CloudProvider>); }).catch(() => root.render(<p role="alert">The isolated shared model fixture could not start.</p>));
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
