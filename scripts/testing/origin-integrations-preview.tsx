import { createRoot } from "react-dom/client";
import { IntegrationKeysSettings } from "../../src/components/IntegrationKeysSettings";
import { initialState, StoreContext } from "../../src/state/store";
import { applySkin } from "../../src/lib/skins";
import "../../src/styles.css";

applySkin(new URLSearchParams(location.search).get("theme") === "light" ? "daylight" : "midnight");

createRoot(document.getElementById("root")!).render(
  <StoreContext.Provider value={{ state: initialState, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}>
    <main className="flex min-h-dvh justify-center bg-app px-4 py-6 text-ink">
      <div className="flex w-full max-w-2xl flex-col gap-3">
        <h1 className="text-[18px] font-semibold text-ink">Integrations</h1>
        <IntegrationKeysSettings />
      </div>
    </main>
  </StoreContext.Provider>,
);
