import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { Excalidraw, CaptureUpdateAction, exportToBlob, reconcileElements, restoreElements } from "@excalidraw/excalidraw";
import type { AppState, BinaryFileData, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import "@excalidraw/excalidraw/index.css";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { useColorScheme } from "@/lib/color-scheme";
import { composeMessage, imageAttachmentFromFile } from "@/lib/composer-attachments";
import { setChiefSectionOf } from "@/lib/origin-chief-section";
import { openOriginPage } from "@/lib/origin-pages";
import { useShowThreads } from "@/lib/thread-preferences";
import { openBot } from "@/state/thread-navigation";
import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { BotAvatar } from "../Avatar";
import { MemberAvatar, personTone } from "../OriginPeople";
import { errorText } from "./repo-url";
import { Loading, Notice, iconButton, inputClass, primaryButton } from "./ui";

type Presence = { userId: string; name: string; x: number; y: number; button: string; updatedAt: number };
type StoredFile = { fileId: string; mimeType: string; url: string | null };
type Pointer = { x: number; y: number; button: "up" | "down" };

const FLUSH_MS = 200;
const PRESENCE_MS = 10_000;
const POINTER_MS = 200;
const PRESENCE_TTL_MS = 30_000;
const BATCH = 100;

/** `canvasId` picks one of a project's canvases; without it the canvas is the workspace's own. `agent` is who "Ask" sends a snapshot to. */
export type DrawingCanvasProps = { teamId: string; canvasId?: string; userId: string; name: string; readOnly: boolean; agent?: Bot; lead?: ReactNode };

function imageBlob(file: BinaryFileData): Blob {
  const separator = file.dataURL.indexOf(",");
  if (!file.dataURL.startsWith("data:") || separator < 0) throw new Error("Invalid drawing image");
  const payload = file.dataURL.slice(separator + 1);
  return new Blob(file.dataURL.slice(0, separator).endsWith(";base64")
    ? [Uint8Array.from(atob(payload), (character) => character.charCodeAt(0))]
    : [decodeURIComponent(payload)], { type: file.mimeType });
}

const readDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as string);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

const versionOf = (element: { version: number; versionNonce: number }) => `${element.version}:${element.versionNonce}`;

export function DrawingCanvas({ teamId, canvasId, userId, name, readOnly, agent, lead }: DrawingCanvasProps) {
  const args = canvasId ? { teamId, canvasId } : { teamId };
  const scene = useCloudQuery<string[]>("draw:scene", args);
  const presence = useCloudQuery<Presence[]>("draw:presence", args);
  const storedFiles = useCloudQuery<StoredFile[]>("draw:files", args);
  const scheme = useColorScheme();
  const [canvas, setCanvas] = useState<ExcalidrawImperativeAPI | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [notice, setNotice] = useState("");
  const [unavailableFiles, setUnavailableFiles] = useState<string[]>([]);
  const [clock, setClock] = useState(Date.now());
  const remote = useRef(false);
  const ready = useRef(false);
  const knownVersions = useRef(new Map<string, string>());
  const pending = useRef(new Map<string, OrderedExcalidrawElement>());
  const busy = useRef(false);
  const retryAt = useRef(0);
  const failures = useRef(0);
  const knownFiles = useRef(new Set<string>());
  const lastPointer = useRef(0);
  const pointer = useRef<Pointer>({ x: 0, y: 0, button: "up" });

  const sendPresence = (leave = false) => void cloudMutation("draw:setPresence", { ...args, ...pointer.current, ...(leave ? { leave: true } : {}) }).catch(() => {});
  const save = (elements: readonly OrderedExcalidrawElement[]) => cloudMutation("draw:updateElements", { ...args, elements: elements.map((element) => JSON.stringify(element)) });

  useEffect(() => {
    if (!canvas || !scene || !initialized) return;
    const incoming = restoreElements(scene.map((data) => JSON.parse(data)), null);
    const current = canvas.getSceneElementsIncludingDeleted();
    const local = new Map(current.map((element) => [element.id, element]));
    const updates = incoming.filter((element) => {
      const mine = local.get(element.id);
      const newer = !mine || element.version > mine.version || (element.version === mine.version && element.versionNonce < mine.versionNonce);
      if (newer || (mine && versionOf(mine) === versionOf(element))) knownVersions.current.set(element.id, versionOf(element));
      return newer;
    });
    if (updates.length) {
      const elements = reconcileElements(current, updates as RemoteExcalidrawElement[], canvas.getAppState());
      remote.current = true;
      canvas.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
      remote.current = false;
    }
    ready.current = true;
  }, [canvas, scene, initialized]);

  useEffect(() => {
    const flush = async () => {
      if (busy.current || !pending.current.size || !ready.current || Date.now() < retryAt.current) return;
      busy.current = true;
      const batch = [...pending.current.values()].slice(0, BATCH);
      for (const element of batch) pending.current.delete(element.id);
      try {
        await save(batch);
        failures.current = 0;
        setNotice("");
      } catch (error) {
        for (const element of batch) if (!pending.current.has(element.id)) pending.current.set(element.id, element);
        retryAt.current = Date.now() + Math.min(30_000, 1000 * 2 ** failures.current++);
        setNotice(errorText(error, "Could not save the drawing"));
      } finally {
        busy.current = false;
      }
    };
    const timer = window.setInterval(() => void flush(), FLUSH_MS);
    const tick = window.setInterval(() => { setClock(Date.now()); sendPresence(); }, PRESENCE_MS);
    sendPresence();
    const protect = (event: BeforeUnloadEvent) => { if (pending.current.size || busy.current) event.preventDefault(); };
    window.addEventListener("beforeunload", protect);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(tick);
      window.removeEventListener("beforeunload", protect);
      const remaining = [...pending.current.values()];
      for (let offset = 0; offset < remaining.length; offset += BATCH) void save(remaining.slice(offset, offset + BATCH)).catch(() => {});
      sendPresence(true);
    };
  }, [teamId, canvasId]);

  const here = (presence ?? []).filter((member) => member.updatedAt > clock - PRESENCE_TTL_MS);
  useEffect(() => {
    if (!canvas || !presence) return;
    const collaborators: AppState["collaborators"] = new Map();
    for (const member of presence) {
      if (member.userId === userId || member.updatedAt <= clock - PRESENCE_TTL_MS) continue;
      collaborators.set(member.userId as Parameters<typeof collaborators.set>[0], {
        username: member.name, pointer: { x: member.x, y: member.y, tool: "pointer" }, button: member.button === "down" ? "down" : "up",
        color: { background: personTone({ name: member.name }), stroke: personTone({ name: member.name }) },
      });
    }
    canvas.updateScene({ collaborators });
  }, [canvas, presence, clock, userId]);

  useEffect(() => {
    if (!canvas || !storedFiles) return;
    for (const file of storedFiles) {
      if (!file.url || canvas.getFiles()[file.fileId]) continue;
      knownFiles.current.add(file.fileId);
      void fetch(file.url)
        .then((response) => { if (!response.ok) throw new Error("Image unavailable"); return response.blob(); })
        .then(readDataUrl)
        .then((dataURL) => {
          canvas.addFiles([{ id: file.fileId, dataURL, mimeType: file.mimeType, created: Date.now() } as BinaryFileData]);
          setUnavailableFiles((current) => current.filter((id) => id !== file.fileId));
        })
        .catch(() => setUnavailableFiles((current) => current.includes(file.fileId) ? current : [...current, file.fileId]));
    }
  }, [canvas, storedFiles]);

  const upload = async (file: BinaryFileData) => {
    try {
      const url = await cloudMutation<string>("draw:uploadUrl", args);
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": file.mimeType }, body: imageBlob(file) });
      if (!response.ok) throw new Error("Image upload failed");
      const { storageId } = await response.json() as { storageId: string };
      await cloudMutation("draw:saveFile", { ...args, fileId: file.id, storageId, mimeType: file.mimeType });
    } catch (error) {
      knownFiles.current.delete(file.id);
      setNotice(errorText(error, "Image upload failed"));
    }
  };

  const onChange = (elements: readonly OrderedExcalidrawElement[], state: AppState, files: BinaryFiles) => {
    if (!ready.current && !state.isLoading) {
      ready.current = true;
      setInitialized(true);
      return;
    }
    if (!ready.current || remote.current || readOnly) return;
    for (const element of elements) {
      if (element.type === "image" && !element.fileId) continue;
      if (knownVersions.current.get(element.id) !== versionOf(element)) {
        pending.current.set(element.id, element);
        knownVersions.current.set(element.id, versionOf(element));
      }
    }
    for (const file of Object.values(files)) {
      if (knownFiles.current.has(file.id)) continue;
      knownFiles.current.add(file.id);
      void upload(file);
    }
  };

  if (scene === undefined) return <Loading label="Loading the drawing" variant="grid" />;
  return (
    <div className="flex min-h-0 flex-1 flex-col origin-overlay-in" data-drawing-canvas>
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-hairline/40 px-3 py-1.5 md:px-4">
        <div className="min-w-0 flex-1">{lead ?? <span className="text-[13px] font-medium text-ink">{name}</span>}</div>
        <DrawPresence here={here} userId={userId} />
        {readOnly && <span className="rounded-full bg-raised px-2.5 py-1 text-[11.5px] text-ink-secondary">View only</span>}
        {agent && canvas && <AskAgent agent={agent} canvas={canvas} name={name} />}
      </div>
      <div className="relative min-h-0 flex-1 bg-app [&_.excalidraw]:[--color-surface-lowest:var(--color-app)]">
      {(notice || unavailableFiles.length > 0) && (
        <p role="alert" className="absolute left-1/2 top-14 z-10 -translate-x-1/2 rounded-lg bg-danger/15 px-3 py-1.5 text-[12.5px] text-danger origin-pop-badge">
          {notice || "A drawing image could not be loaded"}
        </p>
      )}
      <Excalidraw excalidrawAPI={setCanvas} name={name} theme={scheme} isCollaborating viewModeEnabled={readOnly} validateEmbeddable={false}
        initialData={{ elements: scene.map((data) => JSON.parse(data)), appState: { viewBackgroundColor: "transparent", currentItemStrokeColor: "#1e1e1e" }, scrollToContent: true }}
        onChange={onChange}
        onPointerUpdate={({ pointer: next, button }) => {
          pointer.current = { x: next.x, y: next.y, button };
          if (Date.now() - lastPointer.current < POINTER_MS) return;
          lastPointer.current = Date.now();
          sendPresence();
        }}
        UIOptions={{ canvasActions: { loadScene: true, export: { saveFileToDisk: true }, saveToActiveFile: true, toggleTheme: false, changeViewBackgroundColor: false } }} />
    </div>
    </div>
  );
}

function DrawPresence({ here, userId }: { here: readonly Presence[]; userId: string }) {
  if (!here.length) return null;
  const ordered = [...here].sort((a, b) => (a.userId === userId ? -1 : b.userId === userId ? 1 : b.updatedAt - a.updatedAt));
  const names = ordered.map((member) => (member.userId === userId ? "You" : member.name));
  const drawing = ordered.findIndex((member) => member.button === "down");
  const label = `${names.join(", ")} ${names.length === 1 && ordered[0]!.userId !== userId ? "is" : "are"} on this canvas`;
  return (
    <div role="img" aria-label={label} title={label} className="flex items-center gap-2">
      <span className="flex items-center">
        {ordered.slice(0, 5).map((member, index) => (
          <span key={member.userId} style={{ zIndex: 5 - index }} className={cn("relative rounded-[8px] ring-2 ring-app origin-pop-badge", index > 0 && "-ml-1.5")}>
            <MemberAvatar person={{ name: member.name }} size={24} />
            {member.button === "down" && <span aria-hidden="true" className="absolute -inset-0.5 rounded-[9px] border-2 border-accent " />}
          </span>
        ))}
      </span>
      <span className="hidden text-[12px] text-ink-secondary sm:inline">{drawing >= 0 ? `${names[drawing]} drawing…` : `${here.length} here`}</span>
    </div>
  );
}

const MAX_TEXT_SNIPPETS = 24;

function canvasWords(canvas: ExcalidrawImperativeAPI): string {
  const words = canvas.getSceneElements().flatMap((element) => (element.type === "text" && element.text.trim() ? [element.text.trim().replace(/\s+/g, " ")] : []));
  return words.slice(0, MAX_TEXT_SNIPPETS).map((text) => `- ${text}`).join("\n");
}

/** Sends a picture of the canvas, and the words written on it, to the agent's chat. */
function AskAgent({ agent, canvas, name }: { agent: Bot; canvas: ExcalidrawImperativeAPI; name: string }) {
  const { dispatch } = useStore();
  const showThreads = useShowThreads();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const elements = canvas.getSceneElements();
    if (!elements.length) { setError("Draw something first"); return; }
    setBusy(true);
    setError("");
    try {
      const blob = await exportToBlob({ elements, appState: { ...canvas.getAppState(), exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false }, files: canvas.getFiles(), mimeType: "image/png", maxWidthOrHeight: 1600, exportPadding: 32 });
      const image = await imageAttachmentFromFile(new File([blob], `${name.replace(/[^\w -]+/g, "").trim() || "canvas"}.png`, { type: "image/png" }));
      if (!image) throw new Error("Could not attach the snapshot");
      const words = canvasWords(canvas);
      const asked = question.trim() || "What do you make of this sketch? Point out gaps, risks and next steps.";
      dispatch({ type: "send", botId: agent.id, text: composeMessage(`${asked}\n\nThis is a snapshot of the shared "${name}" canvas.${words ? `\nText on the canvas:\n${words}` : ""}`, [image]) });
      setOpen(false);
      setQuestion("");
      if (agent.chiefOfStaff) setChiefSectionOf(agent.id, "chat");
      openOriginPage(null);
      openBot(dispatch, agent, showThreads);
    } catch (cause) {
      setError(errorText(cause, "Could not share the canvas"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className={cn("group flex h-8 items-center gap-1.5 rounded-full border border-accent/35 bg-accent/10 py-1 pl-1 pr-3 text-[12.5px] font-medium text-accent-text outline-none transition-[background-color,transform] hover:bg-accent/20 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent/60", open && "bg-accent/20")}>
        <BotAvatar bot={agent} size={22} animated={false} />
        <Sparkles size={13} aria-hidden="true" className="transition-transform duration-150 group-hover:rotate-12" />Ask {agent.name}
      </button>
      {open && (
        <form onSubmit={(event) => void send(event)} aria-label={`Ask ${agent.name} about this canvas`}
          className="absolute right-0 top-full z-40 mt-2 flex w-[min(340px,calc(100vw-24px))] origin-top-right flex-col gap-2.5 rounded-2xl border border-hairline/60 bg-menu p-3 animate-pop-in">
          <div className="flex items-center gap-2">
            <BotAvatar bot={agent} size={26} />
            <div className="min-w-0 flex-1">
              <strong className="block truncate text-[13px] text-ink">Ask {agent.name}</strong>
            </div>
            <button type="button" className={iconButton} aria-label="Close" onClick={() => setOpen(false)}><X size={14} /></button>
          </div>
          <textarea autoFocus rows={3} className={cn(inputClass, "resize-none")} aria-label="Question" placeholder="What do you make of this sketch?" value={question} disabled={busy}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
            }} />
          {error && <Notice tone="danger">{error}</Notice>}
          <button className={cn(primaryButton, "self-end rounded-full px-4")} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}Send to {agent.name}
          </button>
        </form>
      )}
    </div>
  );
}
