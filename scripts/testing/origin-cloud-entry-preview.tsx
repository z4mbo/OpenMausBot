import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CloudAddDialog } from "../../src/components/CloudAddDialog";
import { ConnectedWorkspacesSettings } from "../../src/components/ConnectedWorkspacesSettings";
import { DesktopWorkspaceSwitcher } from "../../src/components/DesktopWorkspaceSwitcher";
import { applySkin } from "../../src/lib/skins";
import { StoreProvider, useStore } from "../../src/state/store";
import "../../src/styles.css";

applySkin(new URLSearchParams(location.search).get("theme") === "light" ? "atelier" : "midnight");

function Fixture() {
  const { dispatch } = useStore();
  const [servers, setServers] = useState(false);
  useEffect(() => window.ogb?.onOpenAppSettings?.(section => {
    if (section === "cloud-add") dispatch({ type: "openCloudAdd", source: "app_menu" });
  }), [dispatch]);
  useEffect(() => window.ogb?.environments?.onOpenSettings?.(() => setServers(true)), []);
  return <div className="min-h-dvh bg-app text-ink">
    <header className="flex items-center gap-4 border-b border-hairline/40 px-3 py-2">
      <span className="text-[15px] font-semibold">Origin</span>
      <div className="w-64 max-w-[calc(100vw-6rem)]"><DesktopWorkspaceSwitcher /></div>
    </header>
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      {servers ? <><h1 className="text-[17px] font-semibold">Servers</h1><ConnectedWorkspacesSettings /></> :
        <><h1 className="text-[17px] font-semibold">Workspace</h1><p className="text-[13px] text-ink-secondary">Synthetic local workspace. Choose This computer to inspect its real desktop menu action.</p></>}
    </main>
    <CloudAddDialog />
  </div>;
}

createRoot(document.getElementById("root")!).render(<StoreProvider><Fixture /></StoreProvider>);
