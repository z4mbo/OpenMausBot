import { createRoot } from "react-dom/client";
import { PlanUsage } from "../../src/components/PlanUsage";
import { setLocale } from "../../src/lib/i18n";
import { applySkin } from "../../src/lib/skins";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
setLocale("en");
applySkin(params.get("theme") === "light" ? "atelier" : "midnight");
document.documentElement.dataset.usageScenario = params.get("scenario") ?? "missing";

createRoot(document.getElementById("root")!).render(
  <main className="min-h-dvh min-w-0 bg-app px-4 py-6 text-ink sm:px-8">
    <div className="mx-auto w-full max-w-[760px]">
      <div className="mb-6 border-b border-hairline/30 pb-4">
        <p className="mb-1 text-[12px] text-ink-secondary">Settings</p>
        <h1 className="text-[20px] font-medium">Usage</h1>
      </div>
      <PlanUsage />
    </div>
  </main>,
);
