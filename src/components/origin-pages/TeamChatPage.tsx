import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Download, File as FileIcon, Loader2, MessagesSquare, Paperclip, Pencil, Send, Trash2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCloudSession, type CloudUser } from "@/lib/origin-cloud";
import { originRealtime, originRealtimeFile, usePolled, type MemberChatAttachment, type MemberChatMessage, type RealtimeTarget } from "@/lib/origin-realtime";
import { consumeChatFocus, useChatFocus } from "@/lib/origin-chat-focus";
import { mentionChoicesForQuery, mentionedPeople, mentionQueryAt } from "@/lib/mentions";
import { ChatMarkdown } from "../ChatMarkdown";
import { useTeammates, type Teammate } from "../origin-members/teammates";
import { CloudGate, EmptyState, Loading, Notice, iconButton, inputClass, primaryButton, type OriginPageProps } from "./ui";
import { PersonAvatar } from "./PersonAvatar";

const MESSAGES = "/api/local-chat/messages";
const FILES = "/api/local-chat/files";
const CONVERSATIONS = "/api/local-chat/conversations";
const POLL_MS = 2_500;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const REACTIONS = [
  { id: "like", emoji: "👍", label: "Like" },
  { id: "heart", emoji: "❤️", label: "Love" },
  { id: "celebrate", emoji: "🎉", label: "Celebrate" },
  { id: "eyes", emoji: "👀", label: "Looking" },
] as const;

export function TeamChatPage(props: OriginPageProps) {
  const session = useCloudSession();
  return (
    <CloudGate {...props} label="Messages">
      {({ project, projectId, canEdit }) => session.user && project.teamId
        ? <ProjectTeamChat key={projectId} teamId={project.teamId} projectId={projectId} name={project.name} me={session.user} canWrite={canEdit} />
        : <EmptyState icon={<MessagesSquare size={22} />} title="Chat is unavailable" body="This project is not in a shared workspace yet, so there is nobody to chat with." />}
    </CloudGate>
  );
}

function ProjectTeamChat({ teamId, projectId, name, me, canWrite }: { teamId: string; projectId: string; name: string; me: CloudUser; canWrite: boolean }) {
  const people = useTeammates({ projectId });
  return <TeamChat target={{ teamId, conversation: `project:${projectId}` }} projectId={projectId} name={name} me={me} canWrite={canWrite} people={people}
    emptyTitle={`Start the ${name} conversation`} emptyBody="Messages here are shared with everyone in this project." readOnlyNote="You have view-only access to this project." />;
}

function timeLabel(at: number): string {
  const date = new Date(at);
  const today = new Date().toDateString() === date.toDateString();
  return today ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function mergeMessages(older: readonly MemberChatMessage[], latest: readonly MemberChatMessage[]): MemberChatMessage[] {
  const byId = new Map<string, MemberChatMessage>();
  for (const message of [...older, ...latest]) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}

export type TeamChatProps = {
  target: RealtimeTarget; name: string; me: CloudUser; canWrite: boolean; projectId?: string; people: readonly Teammate[];
  emptyTitle: string; emptyBody: string; readOnlyNote: string; markRead?: boolean;
};

const MENTION_CHOICES = 8;

export function TeamChat({ target, projectId, name, me, canWrite, people, emptyTitle, emptyBody, readOnlyNote, markRead = false }: TeamChatProps) {
  const key = `${target.teamId}:${target.conversation}`;
  const { value: latest, error, refresh } = usePolled(
    () => originRealtime<{ messages: MemberChatMessage[]; hasMore: boolean }>(MESSAGES, target),
    POLL_MS, key,
  );
  const [older, setOlder] = useState<MemberChatMessage[]>([]);
  const [olderExhausted, setOlderExhausted] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<MemberChatAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [caret, setCaret] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [focused, setFocused] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const messages = mergeMessages(older, latest?.messages ?? []);
  const lastId = messages.at(-1)?.id;
  const mention = mentionQueryAt(draft, caret);
  const choices = useMemo(
    () => (mention && mention.start !== dismissedAt ? mentionChoicesForQuery(people, mention.query).slice(0, MENTION_CHOICES) : []),
    [mention?.start, mention?.query, dismissedAt, people],
  );
  const focus = useChatFocus();
  const wanted = focus && focus.conversation === (target.conversation ?? "") ? focus : null;

  useEffect(() => {
    if (!focused) bottom.current?.scrollIntoView({ block: "end" });
    if (markRead && lastId) void originRealtime(CONVERSATIONS, target, { method: "PATCH", json: { messageId: lastId } }).catch(() => {});
  }, [lastId]);

  useEffect(() => {
    if (!wanted) return;
    let alive = true;
    void originRealtime<{ messages: MemberChatMessage[] }>(MESSAGES, target, { query: { focus: wanted.messageId } }).then((result) => {
      if (!alive) return;
      setOlder((current) => mergeMessages(result.messages, current));
      setFocused(wanted.messageId);
    }).catch(() => setNotice("That message is no longer here")).finally(() => consumeChatFocus(wanted));
    return () => { alive = false; };
  }, [wanted]);

  useEffect(() => {
    if (!focused) return;
    document.querySelector(`[data-member-message="${CSS.escape(focused)}"]`)?.scrollIntoView({ block: "center" });
    const timer = window.setTimeout(() => setFocused(null), 2_400);
    return () => window.clearTimeout(timer);
  }, [focused]);

  useEffect(() => setHighlight(0), [choices.length, mention?.start]);

  const loadOlder = async () => {
    const first = messages[0];
    if (!first) return;
    try {
      const result = await originRealtime<{ messages: MemberChatMessage[]; hasMore: boolean }>(MESSAGES, target, { query: { before: String(first.createdAt) } });
      setOlder((current) => mergeMessages(result.messages, current));
      if (!result.hasMore) setOlderExhausted(true);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Could not load earlier messages");
    }
  };

  const attach = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setNotice("");
    try {
      for (const file of [...files].slice(0, 8 - pending.length)) {
        if (file.size === 0 || file.size > MAX_FILE_BYTES) throw new Error(`${file.name} must be between 1 byte and 15 MB`);
        const form = new FormData();
        form.append("file", file, file.name);
        const uploaded = await originRealtime<{ file: MemberChatAttachment }>(FILES, target, { body: form, ...(projectId ? { query: { projectId } } : {}) });
        setPending((current) => [...current, uploaded.file]);
      }
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Could not upload the file");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || (!draft.trim() && !pending.length)) return;
    setBusy(true);
    setNotice("");
    try {
      const mentionUserIds = mentionedPeople(draft, people).map((person) => person.userId);
      await originRealtime(MESSAGES, target, { json: { body: draft, attachmentIds: pending.map((file) => file.id), ...(mentionUserIds.length ? { mentionUserIds } : {}) } });
      setDraft("");
      setPending([]);
      refresh();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Could not send the message");
    } finally {
      setBusy(false);
    }
  };

  const change = async (id: string, patch: Record<string, unknown>): Promise<boolean> => {
    try {
      const result = await originRealtime<{ message: MemberChatMessage | null }>(MESSAGES, target, { method: "PATCH", json: { id, ...patch } });
      setOlder((current) => result.message ? current.map((message) => (message.id === id ? result.message! : message)) : current.filter((message) => message.id !== id));
      refresh();
      return true;
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Could not change the message");
      return false;
    }
  };

  const pickMention = (person: Teammate) => {
    if (!mention) return;
    const next = `${draft.slice(0, mention.start)}@${person.name} ${draft.slice(caret)}`;
    const at = mention.start + person.name.length + 2;
    setDraft(next);
    setCaret(at);
    setDismissedAt(mention.start);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(at, at);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (choices.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pickMention(choices[highlight] ?? choices[0]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedAt(mention?.start ?? null);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={`${name} chat`}>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-[calc(var(--glass-top,0px)+0.75rem)] [scroll-padding-top:var(--glass-top,0px)]">
        {latest === undefined && !error && <Loading label="Loading messages" variant="chat" />}
        {latest?.hasMore && !olderExhausted && messages.length > 0 && (
          <button type="button" className="mx-auto mb-3 block rounded-lg px-3 py-1 text-[12.5px] text-ink-secondary hover:bg-raised hover:text-ink" onClick={() => void loadOlder()}>Load earlier messages</button>
        )}
        {latest && messages.length === 0 && (
          <EmptyState icon={<MessagesSquare size={22} />} title={emptyTitle} body={emptyBody} />
        )}
        <ol className="flex flex-col gap-3">
          {messages.map((message) => {
            const mine = message.authorUserId === me._id;
            return (
              <li key={message.id} className={cn("group -mx-2 flex gap-2.5 rounded-xl px-2 py-1 transition-colors hover:bg-raised/30 motion-safe:animate-msg-in", focused === message.id && "ring-2 ring-accent/70")} data-member-message={message.id}>
                <PersonAvatar person={{ name: message.authorName, email: message.authorEmail, avatarUrl: message.avatarUrl ?? null }} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[13px] font-semibold text-ink">{mine ? "You" : message.authorName}</span>
                    <time dateTime={new Date(message.createdAt).toISOString()} className="text-[11px] tabular-nums text-ink-tertiary">{timeLabel(message.createdAt)}</time>
                    {message.editedAt && <span className="text-[11px] text-ink-tertiary">edited</span>}
                    {canWrite && (
                      <span className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100 max-md:opacity-100">
                        {REACTIONS.map((reaction) => (
                          <button key={reaction.id} type="button" title={reaction.label} aria-label={`React ${reaction.label}`}
                            className="rounded px-1 text-[12px] opacity-60 hover:bg-raised hover:opacity-100" onClick={() => void change(message.id, { reaction: reaction.id })}>{reaction.emoji}</button>
                        ))}
                        {mine && <button type="button" className={iconButton} aria-label="Edit message" title="Edit" onClick={() => setEditing({ id: message.id, body: message.body })}><Pencil size={13} /></button>}
                        {mine && <button type="button" className={iconButton} aria-label="Delete message" title="Delete" onClick={() => { if (window.confirm("Delete this message?")) void change(message.id, { delete: true }); }}><Trash2 size={13} /></button>}
                      </span>
                    )}
                  </div>
                  {editing?.id === message.id ? (
                    <form className="mt-1 flex flex-col gap-1.5" onSubmit={(event) => { event.preventDefault(); void change(message.id, { body: editing.body }).then((saved) => { if (saved) setEditing(null); }); }}>
                      <textarea className={cn(inputClass, "min-h-[60px]")} aria-label="Edit message" value={editing.body} onChange={(event) => setEditing({ id: message.id, body: event.target.value })} />
                      <div className="flex gap-2">
                        <button type="submit" className={primaryButton}>Save</button>
                        <button type="button" className={iconButton} aria-label="Cancel editing" onClick={() => setEditing(null)}><X size={14} /></button>
                      </div>
                    </form>
                  ) : message.body && <div className="text-[13.5px] text-ink"><MessageBody message={message} me={me} /></div>}
                  {message.attachments?.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {message.attachments.map((file) => <Attachment key={file.id} file={file} target={target} />)}
                    </div>
                  ) : null}
                  {message.reactions && Object.entries(message.reactions).some(([, users]) => users.length) && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {REACTIONS.filter((reaction) => message.reactions?.[reaction.id]?.length).map((reaction) => {
                        const users = message.reactions![reaction.id]!;
                        return (
                          <span key={reaction.id} className={cn("rounded-full border border-hairline/50 px-1.5 text-[11.5px] text-ink-secondary", users.includes(me._id) && "border-accent/60 text-ink")}>
                            {reaction.emoji} {users.length}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <div ref={bottom} />
      </div>
      <div className="border-t border-hairline/40 p-3">
        {(notice || error) && <div className="mb-2"><Notice tone="danger">{notice || error}</Notice></div>}
        {canWrite ? (
          <form onSubmit={(event) => void send(event)} className="flex flex-col gap-2">
            {pending.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {pending.map((file) => (
                  <span key={file.id} className="flex items-center gap-1 rounded-lg bg-raised px-2 py-1 text-[12px] text-ink">
                    <FileIcon size={12} />{file.name}
                    <button type="button" className="text-ink-secondary hover:text-ink" aria-label={`Remove ${file.name}`} onClick={() => setPending((current) => current.filter((item) => item.id !== file.id))}><X size={12} /></button>
                  </span>
                ))}
              </div>
            )}
            {choices.length > 0 && (
              <div role="listbox" id="team-chat-mentions" aria-label="Mention a teammate" className="flex max-h-60 flex-col overflow-y-auto rounded-xl border border-hairline/40 bg-raised p-1 shadow-lg">
                {choices.map((person, index) => (
                  <button key={person.id} id={`team-chat-mention-${person.id}`} type="button" role="option" aria-selected={index === highlight}
                    onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setHighlight(index)} onClick={() => pickMention(person)}
                    className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink", index === highlight && "bg-panel")}>
                    {person.avatar}
                    <span className="min-w-0 flex-1 truncate font-medium">{person.name}</span>
                    {person.description && <span className="truncate text-[12px] text-ink-tertiary">{person.description}</span>}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-end gap-1.5 rounded-2xl border border-hairline/60 bg-inset p-1.5 transition-colors focus-within:border-accent/60">
              <input ref={fileInput} type="file" multiple hidden onChange={(event) => void attach(event.target.files)} />
              <button type="button" className={iconButton} aria-label="Attach a file" title="Attach a file" disabled={busy || pending.length >= 8} onClick={() => fileInput.current?.click()}><Paperclip size={15} /></button>
              <textarea ref={input} className="max-h-40 min-h-8 flex-1 resize-none bg-transparent px-1 py-1.5 text-[13.5px] text-ink outline-none [field-sizing:content] placeholder:text-ink-tertiary max-md:text-[16px]" rows={1} placeholder={`Message ${name}`} aria-label="Message"
                role="combobox" aria-autocomplete="list" aria-expanded={choices.length > 0} aria-controls={choices.length ? "team-chat-mentions" : undefined}
                aria-activedescendant={choices[highlight] ? `team-chat-mention-${choices[highlight]!.id}` : undefined}
                value={draft} onKeyDown={onKeyDown}
                onChange={(event) => { setDraft(event.target.value); setCaret(event.target.selectionStart ?? event.target.value.length); setDismissedAt(null); }}
                onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)} />
              <button type="submit" className={cn(primaryButton, "size-8 rounded-xl p-0")} disabled={busy || (!draft.trim() && !pending.length)} aria-label="Send">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>
          </form>
        ) : <p className="text-[12.5px] text-ink-secondary">{readOnlyNote}</p>}
      </div>
    </section>
  );
}

function MessageBody({ message, me }: { message: MemberChatMessage; me: CloudUser }) {
  const mentions = message.mentions;
  const peers = useMemo(() => (mentions ?? []).filter((mention) => mention.userId !== me._id).map((mention) => ({ name: mention.name })), [mentions, me._id]);
  const mine = mentions?.find((mention) => mention.userId === me._id);
  return <ChatMarkdown text={message.body} mentionPeers={peers} {...(mine ? { mentionPerson: { profileName: mine.name } } : {})} />;
}

function Attachment({ file, target }: { file: MemberChatAttachment; target: RealtimeTarget }) {
  const image = /^image\/(png|jpeg|gif|webp)$/.test(file.contentType);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!image) return;
    let alive = true;
    let objectUrl: string | null = null;
    void originRealtimeFile(target, file.id).then((blob) => {
      if (!alive) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => {});
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, image, target.teamId, target.conversation]);
  const download = async () => {
    const blob = await originRealtimeFile(target, file.id);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = file.name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  };
  if (image && url) return <img src={url} alt={file.name} className="max-h-60 max-w-[320px] rounded-lg border border-hairline/40 object-contain" />;
  return (
    <button type="button" onClick={() => void download().catch(() => {})} className="flex items-center gap-1.5 rounded-lg border border-hairline/50 bg-panel px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-raised">
      <Download size={13} />{file.name}<span className="text-ink-tertiary">{Math.max(1, Math.round(file.size / 1024))} KB</span>
    </button>
  );
}
