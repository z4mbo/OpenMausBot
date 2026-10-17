import { useEffect, useRef, useState } from "react";
import { Excalidraw, CaptureUpdateAction, reconcileElements, restoreElements } from "@excalidraw/excalidraw";
import type { AppState, BinaryFileData, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import "@excalidraw/excalidraw/index.css";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { useColorScheme } from "@/lib/color-scheme";
import { errorText } from "./repo-url";
import { Loading } from "./ui";

type Presence = { userId: string; name: string; x: number; y: number; button: string; updatedAt: number };
type StoredFile = { fileId: string; mimeType: string; url: string | null };
type Pointer = { x: number; y: number; button: "up" | "down" };

const FLUSH_MS = 200;
const PRESENCE_MS = 10_000;
const POINTER_MS = 200;
const PRESENCE_TTL_MS = 30_000;
const BATCH = 100;

export type DrawingCanvasProps = { teamId: string; userId: string; name: string; readOnly: boolean };

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

export function DrawingCanvas({ teamId, userId, name, readOnly }: DrawingCanvasProps) {
  const args = { teamId };
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

  const sendPresence = (leave = false) => void cloudMutation("draw:setPresence", { teamId, ...pointer.current, ...(leave ? { leave: true } : {}) }).catch(() => {});
  const save = (elements: readonly OrderedExcalidrawElement[]) => cloudMutation("draw:updateElements", { teamId, elements: elements.map((element) => JSON.stringify(element)) });

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
  }, [teamId]);

  useEffect(() => {
    if (!canvas || !presence) return;
    const collaborators: AppState["collaborators"] = new Map();
    for (const member of presence) {
      if (member.userId === userId || member.updatedAt <= clock - PRESENCE_TTL_MS) continue;
      collaborators.set(member.userId as Parameters<typeof collaborators.set>[0], {
        username: member.name, pointer: { x: member.x, y: member.y, tool: "pointer" }, button: member.button === "down" ? "down" : "up",
        color: { background: "#2ebd85", stroke: "#16845b" },
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
      const url = await cloudMutation<string>("draw:uploadUrl", { teamId });
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": file.mimeType }, body: imageBlob(file) });
      if (!response.ok) throw new Error("Image upload failed");
      const { storageId } = await response.json() as { storageId: string };
      await cloudMutation("draw:saveFile", { teamId, fileId: file.id, storageId, mimeType: file.mimeType });
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

  if (scene === undefined) return <Loading label="Loading the drawing" />;
  return (
    <div className="relative min-h-0 flex-1" data-drawing-canvas>
      {(notice || unavailableFiles.length > 0) && (
        <p role="alert" className="absolute left-1/2 top-14 z-10 -translate-x-1/2 rounded-lg bg-danger/15 px-3 py-1.5 text-[12.5px] text-danger">
          {notice || "A drawing image could not be loaded"}
        </p>
      )}
      <Excalidraw excalidrawAPI={setCanvas} name={name} theme={scheme} isCollaborating viewModeEnabled={readOnly} validateEmbeddable={false}
        initialData={{ elements: scene.map((data) => JSON.parse(data)), appState: { viewBackgroundColor: "#ffffff", currentItemStrokeColor: "#1e1e1e" }, scrollToContent: true }}
        onChange={onChange}
        onPointerUpdate={({ pointer: next, button }) => {
          pointer.current = { x: next.x, y: next.y, button };
          if (Date.now() - lastPointer.current < POINTER_MS) return;
          lastPointer.current = Date.now();
          sendPresence();
        }}
        UIOptions={{ canvasActions: { loadScene: true, export: { saveFileToDisk: true }, saveToActiveFile: true, toggleTheme: false, changeViewBackgroundColor: false } }} />
    </div>
  );
}
