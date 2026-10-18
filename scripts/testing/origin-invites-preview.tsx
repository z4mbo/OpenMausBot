import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceMembersPanel } from "@/components/origin-members/WorkspaceMembers";
import { applySkin } from "../../src/lib/skins";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "light" ? "light" : "dark";
applySkin(theme === "light" ? "atelier" : "midnight");
type Metadata = { version: "before" | "after"; baseline: string; sourceHashes: Record<string, string> };
function Fixture() {
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void fetch("/__origin-invites-fixture.json").then(response => response.json()).then((value: Metadata) => { if (live) setMetadata(value); }).catch(() => { if (live) setError("Synthetic fixture metadata could not be loaded"); });
    return () => { live = false; };
  }, []);
  return <main className="min-h-dvh min-w-0 bg-app text-ink">
    <header className="border-b border-hairline px-4 py-3">
      <h1 className="text-[14px] font-semibold">Synthetic invitation fixture · {metadata?.version ?? "loading"}</h1>
      <p className="mt-1 text-[12px] text-ink-secondary">Fake accounts and mail results. No real Convex deployment or email provider is contacted.</p>
      {metadata && <p className="mt-1 break-all text-[11px] text-ink-tertiary">{metadata.version === "before" ? `Frozen UI and route: ${metadata.baseline}` : "Current production UI and route; synthetic cloud transport"}</p>}
      <form className="mt-3 flex flex-wrap items-end gap-2" method="get">
        <input type="hidden" name="version" value={metadata?.version ?? "after"} />
        <label className="text-[12px]">Theme<select className="ml-2 rounded border border-hairline bg-inset px-2 py-1" name="theme" defaultValue={theme}><option value="dark">Dark</option><option value="light">Light</option></select></label>
        <label className="text-[12px]">Synthetic mail<select className="ml-2 rounded border border-hairline bg-inset px-2 py-1" name="mail" defaultValue={params.get("mail") ?? "accepted"}><option value="accepted">Provider accepts</option><option value="failed">Provider fails</option><option value="not_configured">Not configured</option></select></label>
        <label className="text-[12px]">Connection<select className="ml-2 rounded border border-hairline bg-inset px-2 py-1" name="connection" defaultValue={params.get("connection") ?? "official"}><option value="official">Official Origin</option><option value="custom">Custom without public site</option></select></label>
        <button className="ui-button" type="submit">Apply synthetic controls</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </header>
    <div className="mx-auto max-w-3xl pb-6"><WorkspaceMembersPanel cloudTeamId="fixtureteam" /></div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
