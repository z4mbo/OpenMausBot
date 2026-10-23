import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AboutDialog } from "/src/components/AboutDialog";
import { ConfirmDialog } from "/src/components/ConfirmDialog";
import { CenteredDialog } from "/src/components/CenteredDialog";
import { FilesView } from "/src/components/FilesView";
import { initialState, StoreContext } from "/src/state/store";
import { applySkin } from "/src/lib/skins";
import { setLocale } from "/src/lib/i18n";
import { setAnalyticsEnabled } from "/src/lib/analytics";
import "/src/styles.css";

const params = new URLSearchParams(location.search);
const screen = params.get("screen") ?? "about";
setAnalyticsEnabled(false);
setLocale("en");
applySkin(params.get("theme") === "light" ? "atelier" : "midnight");
const marker = "origin-flat-dialogs-031";
const fixture = { marker, synthetic: true, screen, actions: [], settlePending: () => {} };
window.__flatDialogFixture = fixture;
const check = (name, refusal = null) => ({ token: `synthetic-${name}`, name, pcPath: `Fixture/${name}`, files: 12, bytes: 8192, partial: false, refusal });
const folder = { id: "synthetic-folder", name: "Project notes", pcPath: "Fixture/Project notes", files: 12, bytes: 8192, done: 12, status: "synced" };
const fileState = { phase: "idle", lastSyncedAt: 1, disk: null, shared: screen === "files-menu" ? [folder] : [], outputs: { enabled: false, dir: "Fixture/Outputs", folders: 0, problem: null } };
const bridge = {
  state: async () => fileState, onState: () => () => {},
  pickFolder: async () => check("Private folder", "private"),
  checkFolders: async () => [check("Project notes"), check("Design references"), check("Private folder", "private")],
  share: async () => fileState, stopSharing: async () => fileState,
  answerDeletes: async () => fileState, locate: async () => fileState,
  setOutputs: async () => fileState,
  open: async () => { fixture.actions.push("open-synthetic-folder"); }, moreSpace: async () => {},
};
window.ogb = { platform: "win32", cloudAccount: { files: bridge } };

function Fixture() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [nested, setNested] = useState(false);
  const state = { ...initialState, filesSuggest: screen === "files-suggest" && open ? ["Fixture/Project notes"] : null };
  useEffect(() => { fixture.settlePending = () => setPending(false); }, []);
  const start = () => { setPending(screen === "confirm-pending"); setOpen(true); };
  return <StoreContext.Provider value={{ state, dispatch: action => fixture.actions.push(action.type), flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}>
    <main data-flat-dialog-fixture={marker} className="flex min-h-dvh flex-col bg-app text-ink">
      <header className="flex flex-wrap items-center gap-2 border-b border-hairline p-4">
        <button type="button" className="ui-button" data-fixture-opener onClick={start}>Open {screen}</button>
        <button type="button" className="ui-button" data-background-action>Background action</button>
      </header>
      <p className="px-4 py-2 text-[13px] text-ink-secondary">Isolated production components · synthetic state</p>
      {screen === "about" && <AboutDialog open={open} onClose={() => setOpen(false)} />}
      {screen.startsWith("confirm-") && screen !== "confirm-nested" && <ConfirmDialog open={open} tone={screen === "confirm-neutral" ? "neutral" : "danger"}
        title={screen === "confirm-neutral" ? "Share project notes?" : "Remove project notes?"}
        body={screen === "confirm-neutral" ? "The synthetic folder will be available to this workspace." : "The synthetic folder will stop being shared. Your original files stay on this computer."}
        confirmLabel={screen === "confirm-neutral" ? "Share folder" : pending ? "Removing…" : "Remove folder"}
        pending={pending} onCancel={() => setOpen(false)} onConfirm={() => { fixture.actions.push("confirm-synthetic-operation"); setPending(true); }} />}
      {screen === "confirm-nested" && open && <CenteredDialog label="Outer confirmation fixture" onClose={() => setOpen(false)} className="sm:max-w-[440px]">
        {() => <div className="p-5"><button type="button" className="ui-button" onClick={() => setNested(true)}>Open nested confirmation</button>
          <ConfirmDialog open={nested} title="Remove nested notes?" body="Synthetic nested confirmation." confirmLabel="Remove notes" onCancel={() => setNested(false)} onConfirm={() => setNested(false)} />
        </div>}
      </CenteredDialog>}
      {screen.startsWith("files-") && open && <FilesView />}
    </main>
  </StoreContext.Provider>;
}
createRoot(document.getElementById("root")).render(<Fixture />);
