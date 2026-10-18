import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Sidebar } from "../../src/components/Sidebar";
import { DesktopCapabilitiesProvider } from "../../src/components/DesktopCapabilities";
import { initialDesktopCapabilities } from "../../src/lib/desktop";
import { setAdvancedMode } from "../../src/lib/interface-mode";
import { setSidebarDensity, saveSidebarWidth } from "../../src/lib/sidebar-preferences";
import { applySkin } from "../../src/lib/skins";
import { StoreProvider } from "../../src/state/store";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
const platform = params.get("platform") === "mac" ? "darwin" : "win32";
const width = [240, 272, 320].includes(Number(params.get("width"))) ? Number(params.get("width")) : 240;
const advanced = params.get("mode") !== "simple";
const density = params.get("density") === "icons" ? "icons" : params.get("density") === "compact" ? "compact" : "comfortable";
const menuFails = params.get("menu") === "failed";
const computerName = params.get("computer") === "long" ? "Synthetic computer with a very long saved server name that must remain within the sidebar" : "This computer";
applySkin(params.get("theme") === "light" ? "atelier" : "midnight");
saveSidebarWidth(width);
setSidebarDensity(density);
setAdvancedMode(advanced);
Object.assign(window, { ogb: {
  platform,
  getCapabilities: async () => initialDesktopCapabilities(),
  workspaces: {
    state: async () => ({ local: true, name: computerName }),
    menu: async () => {
      window.dispatchEvent(new Event("fixture-computer-menu"));
      if (menuFails) throw new Error("Synthetic computer menu unavailable");
    },
  },
} });

function measure() {
  const sidebar = document.querySelector<HTMLElement>("[data-sidebar]");
  const titlebar = document.querySelector<HTMLElement>("[data-sidebar-top-row]");
  const account = document.querySelector<HTMLElement>('[aria-label="Open account menu"]');
  const computer = document.querySelector<HTMLElement>('[data-tour="server-switcher"]');
  const search = titlebar?.querySelector<HTMLElement>('[aria-label="Search bots and messages"]');
  const peer = sidebar?.querySelector<HTMLElement>('[data-origin-nav-item="inbox"]');
  if (!sidebar || !titlebar || !account || !computer || !search || !peer) return { ready: false };
  const box = (element: HTMLElement) => { const rect = element.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }; };
  const bounds = box(sidebar), chrome = box(titlebar), profile = box(account), host = box(computer), find = box(search), nav = box(peer);
  const menuError = sidebar.querySelector<HTMLElement>('[data-sidebar-computer-row] [role="alert"], [data-workspace-switcher] [role="alert"]');
  const errorBounds = menuError ? box(menuError) : null;
  return { ready: true, platform, requestedSidebarWidth: width, requestedAdvanced: advanced, renderedAdvanced: Boolean(titlebar.querySelector('[aria-label="Collapse sidebar to avatars"]')), density, sidebar: bounds, titlebar: chrome, account: profile, computer: host,
    computerName: computer.textContent, accountName: account.textContent, search: find, peer: nav,
    accountInTitlebar: titlebar.contains(account),
    accountBeforeSearch: profile.right <= find.left && profile.top >= chrome.top && profile.bottom <= chrome.bottom,
    computerBelowTitlebar: host.top >= chrome.bottom,
    computerMatchesPeerHeight: host.height === nav.height,
    computerFontSize: getComputedStyle(computer).fontSize,
    peerFontSize: getComputedStyle(peer.querySelector("span.flex-1") ?? peer).fontSize,
    computerRowFullWidth: host.width >= sidebar.clientWidth - 24,
    controlsDisjoint: profile.right <= host.left || host.right <= profile.left || profile.bottom <= host.top || host.bottom <= profile.top,
    controlsWithinSidebar: [profile, host].every(rect => rect.left >= bounds.left && rect.right <= bounds.right),
    controlsBelowTitlebar: Math.min(profile.top, host.top) >= chrome.bottom,
    menuError: errorBounds,
    menuErrorWithinSidebar: errorBounds ? errorBounds.left >= bounds.left && errorBounds.right <= bounds.right : null,
  };
}

function Fixture() {
  const [metadata, setMetadata] = useState<{ version: string; baseline: string } | null>(null);
  const [proof, setProof] = useState<ReturnType<typeof measure>>({ ready: false });
  const [computerMenus, setComputerMenus] = useState(0);
  useEffect(() => {
    let live = true;
    void fetch("/__origin-header-fixture.json").then(response => response.json()).then(value => { if (live) setMetadata(value); });
    const update = () => setProof(measure());
    const opened = () => setComputerMenus(value => value + 1);
    const frame = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("fixture-computer-menu", opened);
    return () => { live = false; cancelAnimationFrame(frame); window.removeEventListener("resize", update); window.removeEventListener("fixture-computer-menu", opened); };
  }, []);
  return <div className="flex h-dvh min-w-0 bg-app text-ink">
    <Sidebar open onClose={() => {}} />
    <main className="min-w-0 flex-1 overflow-auto p-6">
      <h1 className="text-[16px] font-semibold">Synthetic Origin header · {metadata?.version ?? "loading"}</h1>
      <p className="mt-2 text-[13px] text-ink-secondary">Forty-character account, desktop bridge and isolated local data. No real account or computer menu is accessed.</p>
      <p className="mt-2 text-[12px] text-ink-secondary">{platform} · {width}px · {advanced ? "Advanced" : "Simple"} · {density} · computer menu calls: {computerMenus}</p>
      <button type="button" className="ui-button mt-3" onClick={() => setProof(measure())}>Measure header</button>
      <pre data-header-fit-proof className="mt-4 whitespace-pre-wrap break-all text-[11px]">{JSON.stringify(proof, null, 2)}</pre>
    </main>
  </div>;
}
createRoot(document.getElementById("root")!).render(<DesktopCapabilitiesProvider><StoreProvider><Fixture /></StoreProvider></DesktopCapabilitiesProvider>);
