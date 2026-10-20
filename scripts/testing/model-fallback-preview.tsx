import { useState } from "react";
import { createRoot } from "react-dom/client";
import { baseline } from "virtual:model-fallback-fixture";
import { StoreProvider, api, currentTaskBot, useStore } from "../../src/state/store";
import { ModelPicker } from "../../src/components/ModelPicker";
import { ModelSection } from "../../src/components/bot-settings/ModelSection";
import { UsageSection } from "../../src/components/UsageSection";
import { setLocale } from "../../src/lib/i18n";
import { applySkin } from "../../src/lib/skins";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "light" ? "light" : "dark";
const screen = params.get("screen") ?? "chat";
setLocale("en"); applySkin(theme === "light" ? "atelier" : "midnight");

function Fixture() {
  const { state } = useStore();
  const [armed, setArmed] = useState(false);
  const bot = state.bots[0];
  return <main className="min-h-dvh min-w-0 bg-app px-4 py-6 text-ink sm:px-8">
    <div className="mx-auto flex w-full max-w-[900px] min-w-0 flex-col gap-4">
      <header className="border-b border-hairline/40 pb-4">
        <p className="text-[12px] text-ink-secondary">Isolated verification · {baseline ? "Before" : "After"}</p>
        <h1 className="mt-1 text-[20px] font-medium">Models and API budgets</h1>
        <nav className="mt-3 flex flex-wrap gap-3 text-[13px]" aria-label="Verification screen">
          {["chat", "agent", "usage"].map(value => <a key={value} className="rounded px-2 py-1 text-ink-secondary hover:bg-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" href={`?screen=${value}&theme=${theme}`}>{value === "chat" ? "Chat model" : value === "agent" ? "Agent settings" : "Usage"}</a>)}
        </nav>
      </header>
      {!bot ? <p role="status">Loading the disposable agent…</p> : screen === "usage" ? <UsageSection /> : screen === "agent" ? <ModelSection key={bot.id} bot={bot} /> : <section className="rounded-xl border border-hairline/40 bg-panel p-3">
        <div className="@container/chathead flex min-w-0 items-center justify-between gap-3"><h2 className="text-[15px] font-medium">{bot.name}</h2><ModelPicker key={bot.threadId} bot={currentTaskBot(bot)} threadId={bot.threadId} /></div>
        <div className="flex min-h-80 items-center justify-center text-[13px] text-ink-secondary">Choose the agent’s model above.</div>
      </section>}
      <details className="text-[12px] text-ink-secondary"><summary>Verification controls</summary><p className="mt-2 leading-relaxed">Displayed provider catalogs are synthetic. Agent settings and budgets persist in this fixture’s isolated server. No real model provider is called.</p><button type="button" className="mt-2 rounded-lg border border-hairline/50 px-3 py-2" onClick={() => { void api("/__fixture/model-fallback/fail-next", { method: "POST", body: "{}" }).then(() => setArmed(true)); }}>Fail the next agent save</button>{armed && <p role="status">The next agent save will fail once.</p>}</details>
    </div>
  </main>;
}

const root = createRoot(document.getElementById("root")!);
root.render(<StoreProvider><Fixture /></StoreProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
