import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AuthPage } from "../../site/components/auth-page";
import { useAcceptanceFixture } from "./origin-invite-acceptance-cloud";
import "../../site/app/globals.css";

function Fixture() {
  const controls = useAcceptanceFixture();
  const [version, setVersion] = useState("loading");
  const [localInter, setLocalInter] = useState(false);
  useEffect(() => {
    let live = true;
    void fetch("/__origin-invites-fixture.json").then(response => response.json()).then((metadata: { version: string; font?: { available: boolean } }) => { if (live) { setVersion(metadata.version); setLocalInter(metadata.font?.available === true); } }).catch(() => { if (live) setVersion("metadata unavailable"); });
    return () => { live = false; };
  }, []);
  const button = { padding: "6px 10px", border: "1px solid #9498a3", borderRadius: 6, background: "transparent", color: "inherit", cursor: "pointer" };
  return <>
    <style>{`
      ${localInter ? '@font-face { font-family: "Origin Fixture Inter"; src: url("/__origin-invites-inter.woff2") format("woff2"); font-style: normal; font-weight: 100 900; font-display: swap; }' : ""}
      :root { --font-body: ${localInter ? '"Origin Fixture Inter",' : ""} ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
      .origin-invite-fixture-toolbar { background: var(--origin-light-app); color: var(--origin-light-ink); }
      @media (prefers-color-scheme: dark) { .origin-invite-fixture-toolbar { background: var(--origin-dark-app); color: var(--origin-dark-ink); } }
    `}</style>
    <header className="origin-invite-fixture-toolbar" style={{ padding: 16, borderBottom: "1px solid #9498a3" }}>
      <h1 style={{ fontSize: 16 }}>Synthetic website invitation · {version}</h1>
      <p style={{ fontSize: 12 }}>Real AuthPage and card CSS; fake session/query/mutation, navigation and download shell. No real account or provider is contacted.</p>
      <p style={{ fontSize: 12 }}>Font: {localInter ? "existing local Next Inter asset" : "system sans fallback; local Inter asset unavailable or loading"}.</p>
      <p style={{ fontSize: 12 }}>Click Join workspace, invalidate its preview, then resolve or reject the pending synthetic mutation.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        <button style={button} onClick={controls.invalidate}>Invalidate preview</button>
        <button style={button} disabled={!controls.pending} onClick={controls.resolve}>Resolve acceptance</button>
        <button style={button} disabled={!controls.pending} onClick={controls.reject}>Reject acceptance</button>
        <button style={button} onClick={controls.switchAccount}>Switch synthetic account</button>
        <button style={button} onClick={controls.reset}>Reset fixture</button>
      </div>
      <output style={{ display: "block", fontSize: 12, marginTop: 8 }}>Mutation calls: {controls.mutationCalls} · Preview: {controls.previewAvailable ? "available" : "invalidated"} · Mutation: {controls.pending ? "pending" : "settled"}</output>
    </header>
    <AuthPage mode="signup" inviteToken="synthetic-invite-token" />
  </>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
