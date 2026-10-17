"use client";

import { Fragment, useId, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { ArrowUp, AtSign, Hash, ListTodo, Loader2, Paperclip, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { chatTextParts } from "@/lib/chat-text";
import { chatTrigger, insertChatTag } from "@/lib/chat-composer";
import { containsMention, mentionToken } from "@/lib/issue-mentions";
import { checklistItem } from "@/lib/comment-checklist";
import { localApi } from "@/lib/client-api";
import { validateAttachmentFiles } from "@/lib/dropped-content";
import type { ChatReference } from "@/lib/localRealtime";
import { UserAvatar } from "./user-avatar";
import { useMemberProfile, useWorkspace } from "./workspace-context";
import { useChatSuggestions, type ChatSuggestion } from "./use-chat-suggestions";
import { useFileDrop } from "./use-file-drop";

type Person = { userId?: Id<"users">; name: string; username?: string; email: string; avatarUrl?: string | null };
type Attachment = { id: string; name: string; size: number; contentType: string };

export function IssueCommentBody({ comment, sessionToken, canEdit, onOpenReference }: {
  comment: Doc<"taskComments">; sessionToken: string; canEdit: boolean; onOpenReference: (projectId: Id<"projects">, taskId?: Id<"tasks">) => void;
}) {
  const openMember = useMemberProfile(), check = useMutation(api.tasks.checkCommentItem);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const mentions = (comment.mentions || []).map(m => ({ ...m, name: m.token.slice(1) }));
  const content = (text: string) => chatTextParts(text, mentions, comment.references).map((part, index) => {
    if (part.kind === "mention") return <button key={index} className="inline-mention" onClick={() => { const person = comment.mentions?.find(m => m.userId === part.mention.userId); if (person) openMember(person.email); }}>{part.text}</button>;
    if (part.kind === "reference") return <button key={index} className="inline-mention inline-reference" onClick={() => onOpenReference(part.reference.projectId as Id<"projects">, part.reference.type === "issue" ? part.reference.id as Id<"tasks"> : undefined)}>{part.text}</button>;
    return part.kind === "link" ? <a key={index} href={part.href} target="_blank" rel="noreferrer">{part.text}</a> : <Fragment key={index}>{part.text}</Fragment>;
  });
  return <div className="issue-comment-text">{comment.body.split("\n").map((line, index) => {
    const item = checklistItem(line);
    return item ? <div className="comment-checklist-item" key={index}><input type="checkbox" aria-label={item.text} checked={item.checked} disabled={!canEdit || busy} onChange={async event => {
      setBusy(true); setError("");
      try { await check({ sessionToken, projectId: comment.projectId, commentId: comment._id, line: index, text: item.text, checked: event.target.checked }); }
      catch (error) { setError(error instanceof Error ? error.message : "Could not update checklist"); }
      finally { setBusy(false); }
    }} /><span className={item.checked ? "checked" : ""}>{content(item.text)}</span></div> : <div key={index}>{line ? content(line) : <br />}</div>;
  })}{error && <p className="notice danger" role="alert">{error}</p>}</div>;
}

export function IssueCommentComposer({ projectId, taskId, sessionToken, members }: {
  projectId: Id<"projects">; taskId: Id<"tasks">; sessionToken: string; members: Person[];
}) {
  const post = useMutation(api.tasks.addComment), workspace = useWorkspace(), id = useId();
  const input = useRef<HTMLTextAreaElement>(null), filesInput = useRef<HTMLInputElement>(null), uploading = useRef(false);
  const [body, setBody] = useState(""), [cursor, setCursor] = useState(0);
  const [mentions, setMentions] = useState<{ userId: Id<"users">; token: string }[]>([]);
  const [references, setReferences] = useState<ChatReference[]>([]), [attachments, setAttachments] = useState<Attachment[]>([]);
  const [selection, setSelection] = useState(0), [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false), [uploadBusy, setUploadBusy] = useState(false), [error, setError] = useState("");
  const trigger = dismissed ? null : chatTrigger(body, cursor);
  const suggestions = useChatSuggestions(trigger, members, sessionToken, workspace._id);
  const candidates = suggestions.options;
  const focus = (at: number) => requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(at, at); setCursor(at); });
  const insert = (text: string) => {
    const at = input.current?.selectionStart ?? body.length, end = input.current?.selectionEnd ?? at;
    setBody(body.slice(0, at) + text + body.slice(end)); setCursor(at + text.length); setDismissed(false); setSelection(0); focus(at + text.length);
  };
  const choose = (option: ChatSuggestion) => {
    if (!trigger) return;
    const label = option.member ? mentionToken(option.member).slice(1) : option.label;
    const next = insertChatTag(body, trigger, label);
    if (option.member?.userId) setMentions(current => [...current.filter(m => m.userId !== option.member!.userId), { userId: option.member!.userId!, token: `@${label}` }]);
    if (option.reference) setReferences(current => [...current.filter(r => r.id !== option.reference!.id), option.reference!]);
    setBody(next.text); setDismissed(true); focus(next.cursor);
  };
  const upload = async (files: File[]) => {
    if (busy || uploading.current || !files.length) return;
    uploading.current = true; setUploadBusy(true); setError("");
    try {
      validateAttachmentFiles(files);
      if (attachments.length + files.length > 8) throw new Error("Attach up to 8 files per comment");
      for (const file of files) {
        const form = new FormData(); form.set("file", file);
        const result = await localApi<{ file: Attachment }>(`/api/local-chat/files?teamId=${workspace._id}&projectId=${projectId}`, sessionToken, { method: "POST", body: form });
        setAttachments(current => [...current, result.file]);
      }
    } catch (error) { setError(error instanceof Error ? error.message : "Could not upload file"); }
    finally { uploading.current = false; setUploadBusy(false); }
  };
  const drop = useFileDrop({ disabled: busy || uploadBusy, onFiles: files => void upload(files), onLink: url => insert(url) });
  const submit = async () => {
    if ((!body.trim() && !attachments.length) || busy || uploadBusy) return;
    setBusy(true); setError("");
    try {
      await post({ projectId, taskId, sessionToken, body, mentions: mentions.filter(m => containsMention(body, m.token)), references: references.filter(r => containsMention(body, `#${r.label}`)).map(r => ({ ...r, projectId: r.projectId as Id<"projects"> })), attachments: attachments.map(({ id, name, size, contentType }) => ({ id, name, size, contentType })) });
      setBody(""); setMentions([]); setReferences([]); setAttachments([]); setCursor(0);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not send comment"); }
    finally { setBusy(false); }
  };
  return <form className={`issue-comment-composer ${drop.dragging ? "drop-active" : ""}`} {...drop.handlers} onSubmit={event => { event.preventDefault(); void submit(); }} onPaste={event => { if (event.clipboardData.files.length) { event.preventDefault(); void upload(Array.from(event.clipboardData.files)); } }}>
    <div className="issue-mention-input">
      {trigger && <div className="issue-mention-menu" role="listbox" id={id} aria-label={trigger.kind === "member" ? "Mention a member" : "Reference a project or issue"}>
        {candidates.map((option, index) => <button id={`${id}-${index}`} type="button" role="option" aria-selected={index === selection} key={option.key} onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}>{option.member ? <UserAvatar user={option.member} size="small" /> : <Hash size={16} />}<span>{option.label}<small>{option.detail}</small></span></button>)}
        {!candidates.length && <p>{suggestions.loading ? "Searching..." : "No matches"}</p>}
        {suggestions.loadMore && <button type="button" onClick={suggestions.loadMore}>Load more</button>}
      </div>}
      <textarea ref={input} aria-label="Comment" aria-controls={trigger ? id : undefined} aria-activedescendant={candidates.length ? `${id}-${selection % candidates.length}` : undefined} value={body} onChange={event => { setBody(event.target.value); setCursor(event.target.selectionStart); setDismissed(false); setSelection(0); }} onSelect={event => setCursor(event.currentTarget.selectionStart)} onKeyDown={event => {
        if (trigger && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDismissed(true); }
        else if (candidates.length && ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          if (event.key === "Enter") choose(candidates[selection % candidates.length]);
          else setSelection(current => (current + (event.key === "ArrowDown" ? 1 : -1) + candidates.length) % candidates.length);
        } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(); }
        else if (event.key === "Enter") {
          const line = body.slice(0, input.current?.selectionStart).split("\n").at(-1) || "";
          if (/^\s*- \[[ xX]\] .+/.test(line)) { event.preventDefault(); insert("\n- [ ] "); }
        }
      }} rows={3} placeholder="Leave a comment..." disabled={busy} maxLength={8000} />
    </div>
    {!!attachments.length && <div className="composer-attachments">{attachments.map(file => <span key={file.id}><Paperclip size={13} />{file.name}<button type="button" aria-label={`Remove ${file.name}`} disabled={busy} onClick={() => setAttachments(current => current.filter(item => item.id !== file.id))}><X size={13} /></button></span>)}</div>}
    {error && <p className="notice danger" role="alert">{error}</p>}
    <footer><div>
      <input ref={filesInput} type="file" multiple hidden aria-label="Comment attachments" onChange={event => { void upload(Array.from(event.target.files || [])); event.target.value = ""; }} />
      <button type="button" className="icon-button" title="Attach files or media" aria-label="Attach files or media" disabled={busy || uploadBusy} onClick={() => filesInput.current?.click()}>{uploadBusy ? <Loader2 size={16} className="spin" /> : <Paperclip size={16} />}</button>
      <button type="button" className="icon-button" title="Mention a member" aria-label="Mention a member" disabled={busy} onClick={() => insert(`${cursor && !/\s/.test(body[cursor - 1]) ? " " : ""}@`)}><AtSign size={16} /></button>
      <button type="button" className="icon-button" title="Reference a project or issue" aria-label="Reference a project or issue" disabled={busy} onClick={() => insert(`${cursor && !/\s/.test(body[cursor - 1]) ? " " : ""}#`)}><Hash size={16} /></button>
      <button type="button" className="icon-button" title="Add checklist" aria-label="Add checklist" disabled={busy} onClick={() => insert(`${cursor && body[cursor - 1] !== "\n" ? "\n" : ""}- [ ] `)}><ListTodo size={16} /></button>
    </div><button className="send-message" type="submit" title="Send comment" aria-label="Send comment" disabled={busy || uploadBusy || (!body.trim() && !attachments.length)}>{busy ? <Loader2 size={16} className="spin" /> : <ArrowUp size={19} strokeWidth={2.2} />}</button></footer>
  </form>;
}
