"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Command, CornerDownLeft, Inbox, Keyboard, PanelLeft, Plus, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import { isReleaseHistory, releases, releaseStorageKey } from "@/lib/releases";
import { hasOpenKeyboardOverlay, isEditingTarget } from "@/lib/keyboard-navigation";
import { Dialog } from "./dialog";

const seenThisSession = new Set<string>();
const changeIcons = [Keyboard, Plus, PanelLeft, Inbox, SlidersHorizontal];

function ReleasePreview() {
  return <div className="release-preview" aria-hidden="true">
    <div className="release-keyboard-demo"><div><kbd>C</kbd><Plus size={13} /><span>New issue</span></div><div><kbd>F</kbd><Search size={13} /><span>Find anything</span></div><div><kbd><CornerDownLeft size={16} /></kbd><span>Open best match</span></div><div className="release-shortcut-caption"><Command size={12} />Less clicking. More doing.</div></div>
  </div>;
}

export function WhatsNew({ userId, createdAt }: { userId: string; createdAt?: number }) {
  const [history, setHistory] = useState(releases);
  const latestRelease = history[0];
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const key = releaseStorageKey(userId);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch("/api/releases", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const next: unknown = await response.json();
        if (!controller.signal.aborted && isReleaseHistory(next)) setHistory(current => current[0].version === next[0].version ? current : next);
      } catch { /* The bundled changelog remains available offline. */ }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 300000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("online", refresh); };
  }, []);
  useEffect(() => {
    let seen = seenThisSession.has(`${key}:${latestRelease.version}`);
    try { seen ||= localStorage.getItem(key) === latestRelease.version; } catch { /* The session still remembers dismissed updates. */ }
    // Accounts created after this release never saw the previous version, so there is nothing new to announce.
    if (!seen && createdAt !== undefined && createdAt >= Date.parse(`${latestRelease.date}T00:00:00Z`)) {
      seen = true;
      seenThisSession.add(`${key}:${latestRelease.version}`);
      try { localStorage.setItem(key, latestRelease.version); } catch { /* The session still remembers it. */ }
    }
    setUnread(!seen);
    if (seen) return;
    let interacted = false;
    const interacting = () => { interacted = true; };
    const timer = window.setTimeout(() => {
      if (!interacted && !document.hidden && !isEditingTarget(document.activeElement) && !hasOpenKeyboardOverlay()) setOpen(true);
    }, 1000);
    document.addEventListener("keydown", interacting, { once: true });
    document.addEventListener("pointerdown", interacting, { once: true });
    const sync = (event: StorageEvent) => { if (event.key === key && event.newValue === latestRelease.version) { setUnread(false); setOpen(false); } };
    window.addEventListener("storage", sync);
    return () => { clearTimeout(timer); document.removeEventListener("keydown", interacting); document.removeEventListener("pointerdown", interacting); window.removeEventListener("storage", sync); };
  }, [key, latestRelease.version, createdAt]);
  const close = () => {
    seenThisSession.add(`${key}:${latestRelease.version}`);
    try { localStorage.setItem(key, latestRelease.version); } catch { /* Keep working when storage is unavailable. */ }
    setUnread(false);
    setOpen(false);
  };
  return <>
    <button className="sidebar-whats-new" onClick={() => setOpen(true)} aria-label={`What's new v${latestRelease.version}${unread ? ", unread update" : ""}`}>
      <Sparkles size={14} /><span>{"What's new"}</span>{unread && <i aria-hidden="true" />}<small> v{latestRelease.version}</small><ArrowUpRight size={13} />
    </button>
    {open && <Dialog title="What's new" className="release-dialog" onClose={close}>
      <div className="release-history">{history.map(release => <article className="release-entry" key={release.version}>
        <div className="release-meta"><span>Version {release.version}</span><time dateTime={release.date}>{new Date(`${release.date}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</time></div>
        <h3>{release.title}</h3>
        {release.version === "1.0" && <ReleasePreview />}
        <ul>{release.changes.map((change, index) => { const Icon = changeIcons[index % changeIcons.length]; return <li key={change.title}><span className="release-change-icon"><Icon size={17} /></span><div><h4>{change.title}</h4><p>{change.body}</p></div></li>; })}</ul>
      </article>)}</div>
    </Dialog>}
  </>;
}
