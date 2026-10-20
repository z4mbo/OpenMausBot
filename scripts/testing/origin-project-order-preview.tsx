import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CloudProvider, setCloudUrl } from "../../src/lib/origin-cloud";
import { setSessionToken } from "../../src/lib/origin-cloud/client";
import { SidebarProjects } from "../../src/components/SidebarProjects";
import { applySkin } from "../../src/lib/skins";
import { setLocale } from "../../src/lib/i18n";
import type { Bot } from "../../src/state/store";
import "../../src/styles.css";

type Bootstrap = { client: string; url: string; sessionToken: string; teamId: string; projects: Array<{ id: string; name: string }> };
const params = new URLSearchParams(location.search);
setLocale("en"); applySkin(params.get("theme") === "light" ? "atelier" : "midnight");

function Fixture({ data }: { data: Bootstrap }) {
  const [role, setRole] = useState("member");
  const [state, setState] = useState<unknown>(null);
  const [error, setError] = useState("");
  const projects = data.projects.map(project => ({ ...project, tasks: [] }) as unknown as Bot);
  const refresh = () => void fetch("/__fixture/project-order/state").then(response => response.json()).then(setState);
  useEffect(refresh, []);
  return <main className="min-h-dvh bg-app p-4 text-ink sm:p-8">
    <div className="mx-auto w-full max-w-[900px]">
      <p className="text-[12px] text-ink-secondary">Isolated native backend · {data.client}</p>
      <h1 className="mt-1 text-[20px] font-medium">Shared project order</h1>
      <p className="mt-2 text-[13px] text-ink-secondary">Actual workspace records and live subscriptions. Each browser has different local Chief IDs and a reversed local preference.</p>
      <aside className="mt-5 w-full max-w-[280px] rounded-xl border border-hairline/40 bg-panel p-2">
        <SidebarProjects projects={projects} cloudTeamId={data.teamId} row={bot => <button type="button" className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2.5 text-left text-[14px] hover:bg-raised"><span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-inset text-[12px]">{bot.name.slice(0, 1)}</span><span className="min-w-0 truncate">{bot.name}</span></button>} />
      </aside>
      <details className="mt-5 text-[12px] text-ink-secondary"><summary>Verification controls and scope</summary>
        <p className="mt-2">Synthetic people, workspace and project records only. The surrounding shell and project row bodies are controlled; this is not full App or packaged desktop acceptance. No model, email or GitHub calls run.</p>
        <button type="button" className="ui-button mt-2" onClick={refresh}>Read persisted order</button>
        {data.client === "owner" && <button type="button" className="ui-button ml-2 mt-2" onClick={() => { const next = role === "member" ? "viewer" : "member"; void fetch("/__fixture/project-order/member-role", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: next }) }).then(response => { if (!response.ok) throw new Error("Could not change synthetic member role"); setRole(next); }).catch(cause => setError(cause.message)); }}>Make member {role === "member" ? "read-only" : "editable"}</button>}
        {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
        <pre className="mt-3 whitespace-pre-wrap break-all text-[11px]">{JSON.stringify(state, null, 2)}</pre>
      </details>
    </div>
  </main>;
}

const root = createRoot(document.getElementById("root")!);
void fetch("/__fixture/project-order/bootstrap").then(response => response.json()).then((data: Bootstrap) => {
  setCloudUrl(data.url); setSessionToken(data.sessionToken);
  if (!localStorage.getItem("origin-order-fixture")) {
    localStorage.setItem("origin-workspaces", JSON.stringify({ order: data.projects.map(project => project.id).reverse(), sort: "custom", collapsed: false }));
    localStorage.setItem("origin-order-fixture", data.teamId);
  }
  root.render(<CloudProvider><Fixture data={data} /></CloudProvider>);
}).catch(() => root.render(<p role="alert">The isolated project-order fixture could not start.</p>));
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
