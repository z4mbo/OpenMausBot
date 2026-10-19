import { createRoot } from "react-dom/client";
import { PairPage } from "../../src/pair/PairPage";
import { Terminal } from "../../src/components/onboarding/reel/scenes/Terminal";
import { applySkin } from "../../src/lib/skins";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
applySkin(params.get("theme") === "light" ? "atelier" : "midnight");
const screen = params.get("screen") === "terminal" ? "terminal" : "pairing";
createRoot(document.getElementById("root")!).render(screen === "terminal"
  ? <main className="flex min-h-screen items-center justify-center bg-app p-4"><div className="h-[420px] w-full max-w-[620px]"><Terminal playing={false} label="Origin command-line onboarding" /></div></main>
  : <PairPage initialCode={null} />);
