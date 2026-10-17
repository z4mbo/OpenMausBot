"use client";
import { useRef, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { Loader2, Upload } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { localApi } from "@/lib/client-api";
import { validateAttachmentFiles } from "@/lib/dropped-content";
import { useWorkspace } from "./workspace-context";
import { useFileDrop } from "./use-file-drop";

export function IssueFileUpload({ projectId, taskId, sessionToken, disabled, onLink, children }: { projectId: Id<"projects">; taskId: Id<"tasks">; sessionToken: string; disabled: boolean; onLink: (url: string) => void; children: ReactNode }) {
  const workspace = useWorkspace();
  const attach = useMutation(api.tasks.addAsset);
  const input = useRef<HTMLInputElement>(null), inFlight = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const upload = async (files: File[]) => {
    if (disabled || inFlight.current || !files.length) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      validateAttachmentFiles(files);
      for (const file of files) {
        const form = new FormData(); form.set("file", file);
        const { file: saved } = await localApi<{ file: { id: string; name: string; contentType: string; size: number } }>(`/api/local-chat/files?teamId=${workspace._id}&projectId=${projectId}`, sessionToken, { method: "POST", body: form });
        await attach({ projectId, taskId, sessionToken, name: saved.name, type: /^image\/(png|jpeg|gif|webp)$/.test(saved.contentType) ? "image" : "file", localFileId: saved.id, contentType: saved.contentType, size: saved.size });
      }
    } catch (error) { setError(error instanceof Error ? error.message : "Could not attach file"); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const drop = useFileDrop({ disabled: disabled || busy, onFiles: files => void upload(files), onLink });
  return <div className={`issue-file-drop ${drop.dragging ? "drop-active" : ""}`} {...drop.handlers} onPaste={event => { if (event.clipboardData.files.length && !disabled && !busy) { event.preventDefault(); void upload(Array.from(event.clipboardData.files)); } }}>
    {!disabled && <div className="issue-upload-actions"><input ref={input} type="file" multiple hidden aria-label="Issue attachments" onChange={event => { void upload(Array.from(event.target.files || [])); event.target.value = ""; }} /><button type="button" className="icon-button" aria-label="Upload files or images" title="Upload files or images" disabled={busy} onClick={() => input.current?.click()}>{busy ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}</button>{busy && <span role="status">Uploading attachments...</span>}</div>}
    {children}
    {error && <p className="notice danger" role="alert">{error}</p>}
  </div>;
}
