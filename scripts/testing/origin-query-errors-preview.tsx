import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AssetsPage } from "../../src/components/origin-pages/AssetsPage";
import { CloudGate, Loading, primaryButton } from "../../src/components/origin-pages/ui";
import { useCloudPages, useCloudQuery } from "../../src/lib/origin-cloud/hooks";
import { setCloudUrl, setSessionToken } from "../../src/lib/origin-cloud/client";
import { applySkin } from "../../src/lib/skins";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
const backend = new URL(params.get("backend") ?? "");
if (backend.hostname !== "127.0.0.1" || backend.protocol !== "http:") throw new Error("Only the explicitly selected loopback query fixture is allowed");
setCloudUrl(backend.origin);
setSessionToken("synthetic-private-session");
applySkin(params.get("theme") === "light" ? "atelier" : "midnight");
function Pages() {
  const { results, status } = useCloudPages<string>("fixture:pages", {}, 5);
  return status === "loading" ? <Loading label="Loading synthetic pages" /> : <p>{results.join(", ")}</p>;
}
function LegacyQuery() {
  const value = useCloudQuery("design:list", {});
  return value === undefined ? <Loading label="Loading assets" variant="grid" /> : <p>Ready</p>;
}
function Fixture() {
  const [count, setCount] = useState(0);
  return <main className="flex h-dvh min-w-0 flex-col bg-app p-4 text-ink"><button className={`${primaryButton} mb-4 self-start`} onClick={() => setCount(count + 1)}>Outside component {count}</button>
    {params.has("legacy") ? (params.get("screen") === "pages" ? <Pages /> : <LegacyQuery />) : params.get("screen") === "pages" ? <CloudGate cloudProjectId="fixture-project" projectName="Fixture project" label="Pages">{() => <Pages />}</CloudGate> : <AssetsPage cloudProjectId="fixture-project" projectName="Fixture project" />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
