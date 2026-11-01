"use client";
import { errorText } from "@/lib/error-text";

import { RECONNECT_TO_CREATE, useWorkspaceOnline } from "./workspace-connection";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Copy,
  AtSign,
  Check,
  Circle,
  CirclePlus,
  File,
  Hash,
  Heart,
  Loader2,
  MessageCircle,
  Paperclip,
  Pencil,
  Pin,
  Reply,
  Smile,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import type {
  ChatAttachment,
  ChatMention,
  ChatReference,
  LocalChatMessage,
} from "@/lib/localRealtime";
import { localApi } from "@/lib/client-api";
import { useMemberProfile, useWorkspace } from "./workspace-context";
import { UserAvatar, memberName } from "./user-avatar";
import { ContentSkeleton } from "./content-skeleton";
import type { ChatMember } from "./chat-shell";
import {
  chatTrigger,
  insertChatTag,
  type ChatTrigger,
} from "@/lib/chat-composer";
import {
  useChatSuggestions,
  type ChatSuggestion,
} from "./use-chat-suggestions";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { IssueComposer } from "./issue-composer";
import { LocalAttachment } from "./local-attachment";
import { LOCALE, displayName, formatDate, formatDateTime, formatTime } from "@/lib/format";
import { activeChatTags, chatMessageParts, chatTextParts } from "@/lib/chat-text";
import { useChatTypingFocus } from "./use-chat-typing-focus";
import { hasOpenKeyboardOverlay } from "@/lib/keyboard-navigation";
const drafts = new Map<string, string>();

type User = {
  _id: Id<"users">;
  name: string;
  username?: string;
  email: string;
  avatarUrl?: string | null;
};

function dayLabel(time: number) {
  const date = new Date(time);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  today.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Yesterday";
  return `${date.toLocaleDateString(LOCALE, { weekday: "long" })}, ${formatDate(date)}`;
}

export function ChatThread({
  sessionToken,
  user,
  onOpenReference,
  focusMessageId,
  members,
  conversation,
  recipient,
  onBack,
  query,
  pinnedOnly,
  onRead,
}: {
  sessionToken: string;
  user: User;
  onOpenReference: (projectId: Id<"projects">, taskId?: Id<"tasks">) => void;
  focusMessageId?: string;
  members?: ChatMember[];
  conversation: string;
  recipient?: ChatMember;
  onBack: () => void;
  query: string;
  pinnedOnly: boolean;
  onRead: () => Promise<void>;
}) {
  const workspace = useWorkspace();
  const openMember = useMemberProfile();
  const draftKey = `${user._id}:${workspace._id}:${conversation}`;
  const [messages, setMessages] = useState<LocalChatMessage[]>([]);
  const [issueMessage, setIssueMessage] = useState<LocalChatMessage | null>(null);
  const projects = useQuery(api.projects.listForUser, issueMessage ? { sessionToken, teamId: workspace._id } : "skip");
  const [searchResults, setSearchResults] = useState<LocalChatMessage[]>([]);
  const [searching, setSearching] = useState(false);
  const [moreResults, setMoreResults] = useState(false);
  const searchText = query.trim();
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [body, setBody] = useState(() => drafts.get(draftKey) || "");
  const [copied, setCopied] = useState("");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [notice, setNotice] = useState("");
  const [reply, setReply] = useState<LocalChatMessage | null>(null);
  const [editing, setEditing] = useState<LocalChatMessage | null>(null);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  // Local thumbnails for images waiting in the composer, keyed by attachment id.
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const previewsRef = useRef(previews);
  previewsRef.current = previews;
  useEffect(() => {
    const ids = new Set(attachments.map(file => file.id));
    setPreviews(current => {
      const stale = Object.keys(current).filter(id => !ids.has(id));
      if (!stale.length) return current;
      stale.forEach(id => URL.revokeObjectURL(current[id]));
      return Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id)));
    });
  }, [attachments]);
  useEffect(() => () => Object.values(previewsRef.current).forEach(url => URL.revokeObjectURL(url)), []);
  const [references, setReferences] = useState<ChatReference[]>([]);
  const [mentions, setMentions] = useState<ChatMention[]>([]);
  const [trigger, setTrigger] = useState<ChatTrigger | null>(null);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [focusedMessage, setFocusedMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newBelow, setNewBelow] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const highlightsRef = useRef<HTMLDivElement>(null);
  const draftParts = useMemo(() => chatTextParts(body, editing?.mentions ?? mentions, editing?.references ?? references), [body, editing, mentions, references]);
  const activeTags = activeChatTags(draftParts);
  const uploadRef = useRef<HTMLInputElement>(null);
  const scope = `teamId=${workspace._id}${conversation ? `&conversation=${encodeURIComponent(conversation)}` : ""}`;
  const endpoint = `/api/local-chat/messages?${scope}`;
  const searchGeneration = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const generation = ++searchGeneration.current;
    setSearchResults([]); setMoreResults(false); setSearching(Boolean(searchText));
    if (!searchText) return () => controller.abort();
    const timer = setTimeout(() => {
      void localApi<{ messages: LocalChatMessage[]; hasMore: boolean }>(`${endpoint}&search=${encodeURIComponent(searchText)}`, sessionToken, { signal: controller.signal })
        .then(result => { if (!controller.signal.aborted) { setSearchResults(result.messages); setMoreResults(result.hasMore); } })
        .catch(error => { if (!controller.signal.aborted) setNotice(errorText(error, "Search failed")); })
        .finally(() => { if (generation === searchGeneration.current) setSearching(false); });
    }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [searchText, endpoint, sessionToken]);
  const olderSearchResults = async () => {
    const generation = searchGeneration.current;
    setSearching(true);
    try {
      const result = await localApi<{ messages: LocalChatMessage[]; hasMore: boolean }>(`${endpoint}&search=${encodeURIComponent(searchText)}&before=${searchResults[0]?.createdAt}`, sessionToken);
      if (generation === searchGeneration.current) { setSearchResults(current => [...result.messages, ...current]); setMoreResults(result.hasMore); }
    } catch (error) { if (generation === searchGeneration.current) setNotice(errorText(error, "Search failed")); }
    finally { if (generation === searchGeneration.current) setSearching(false); }
  };
  const online = useWorkspaceOnline();
  const canWrite =
    online && workspace.role !== "viewer" && (!conversation || Boolean(recipient));
  useChatTypingFocus(inputRef, canWrite);
  const wasSending = useRef(false);
  useEffect(() => {
    const input = inputRef.current;
    if (wasSending.current && !sending && canWrite && input && !hasOpenKeyboardOverlay() &&
      (document.activeElement === document.body || input.closest("form")?.contains(document.activeElement))) input.focus({ preventScroll: true });
    wasSending.current = sending;
  }, [sending, canWrite]);
  // Messages store the author's name at send time; prefer the member's current full name.
  const nameOf = (message: LocalChatMessage) => {
    const member = members?.find(m => m.userId === message.authorUserId || m.email.toLowerCase() === message.authorEmail.toLowerCase());
    return member ? displayName(member) : message.authorUserId === user._id ? displayName(user) : message.authorName;
  };
  const suggestions = useChatSuggestions(
    trigger,
    members,
    sessionToken,
    workspace._id,
  );
  const activeSuggestion = Math.min(
    suggestionIndex,
    Math.max(0, suggestions.options.length - 1),
  );
  const updateTrigger = (text: string, cursor: number) => {
    const next = editing ? null : chatTrigger(text, cursor);
    setTrigger(conversation && next?.kind === "member" ? null : next);
    setSuggestionIndex(0);
  };
  const chooseSuggestion = (option: ChatSuggestion) => {
    if (
      !trigger ||
      (option.member && !activeTags.mentionIds.has(option.member.userId!) && activeTags.mentionIds.size >= 20) ||
      (option.reference && !activeTags.referenceIds.has(option.reference.id) && activeTags.referenceIds.size >= 12)
    )
      return;
    const next = insertChatTag(body, trigger, option.insert);
    if (next.text.length > 8000) return;
    if (option.member?.userId)
      setMentions((previous) => {
        const current = previous.filter(m => activeTags.mentionIds.has(m.userId));
        return current.some((m) => m.userId === option.member!.userId)
          ? current
          : [
              ...current,
              { userId: option.member!.userId!, name: option.insert },
            ];
      });
    if (option.reference)
      setReferences((previous) => {
        const current = previous.filter(r => activeTags.referenceIds.has(r.id));
        return current.some((r) => r.id === option.reference!.id)
          ? current
          : [...current, option.reference!];
      });
    setBody(next.text);
    setTrigger(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  };
  const openSuggestions = (symbol: "@" | "#") => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? body.length,
      end = input?.selectionEnd ?? start;
    const prefix = start > 0 && !/\s/.test(body[start - 1]) ? " " : "";
    const text = body.slice(0, start) + prefix + symbol + body.slice(end),
      cursor = start + prefix.length + 1;
    setBody(text);
    updateTrigger(text, cursor);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(cursor, cursor);
    });
  };
  const alive = useRef(true),
    sendLock = useRef(false),
    uploadLock = useRef(false),
    lastRead = useRef("");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!editing) {
      if (body) drafts.set(draftKey, body);
      else drafts.delete(draftKey);
      if (drafts.size > 100) drafts.delete(drafts.keys().next().value!);
    }
    const input = inputRef.current;
    if (input) {
      input.style.height = "0px";
      input.style.height = `${Math.min(160, Math.max(40, input.scrollHeight))}px`;
      if (highlightsRef.current) highlightsRef.current.scrollTop = input.scrollTop;
    }
  }, [body, draftKey, editing]);
  const markRead = useCallback(
    async (message?: LocalChatMessage) => {
      if (
        !conversation ||
        !message ||
        document.hidden ||
        lastRead.current === message.id
      )
        return;
      await localApi(`/api/local-chat/conversations?${scope}`, sessionToken, {
        method: "PATCH",
        json: { messageId: message.id },
      });
      lastRead.current = message.id;
      await onRead();
    },
    [conversation, scope, sessionToken, onRead],
  );
  const scrollBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setNewBelow(false);
    stickRef.current = true;
  };
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const result = await localApi<{
        messages: LocalChatMessage[];
        hasMore: boolean;
      }>(endpoint, sessionToken, { signal });
      if (!alive.current || signal?.aborted) return;
      setMessages((current) => {
        const first = result.messages[0]?.createdAt ?? 0;
        return result.hasMore
          ? [...current.filter((m) => m.createdAt < first), ...result.messages]
          : result.messages;
      });
      setHasMore((current) => current || result.hasMore);
      setLoading(false);
      if (stickRef.current) await markRead(result.messages.at(-1));
    },
    [endpoint, sessionToken, markRead],
  );
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const poll = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        await refresh(controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) {
          setNotice(
            errorText(error, "Chat unavailable"),
          );
          setLoading(false);
        }
      } finally {
        busy = false;
      }
    };
    void poll();
    const timer = setInterval(poll, 2500);
    document.addEventListener("visibilitychange", poll);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [refresh]);
  useEffect(() => {
    if (stickRef.current) scrollBottom();
    else setNewBelow(true);
  }, [messages.length]);
  useEffect(() => {
    if (!focusMessageId || conversation) return;
    let alive = true;
    stickRef.current = false;
    void localApi<{ messages: LocalChatMessage[] }>(
      `${endpoint}&focus=${encodeURIComponent(focusMessageId)}`,
      sessionToken,
    )
      .then((result) => {
        if (!alive) return;
        setMessages((current) =>
          [
            ...new Map(
              [...current, ...result.messages].map((m) => [m.id, m]),
            ).values(),
          ].sort((a, b) => a.createdAt - b.createdAt),
        );
        setFocusedMessage(focusMessageId);
      })
      .catch(() => {
        if (alive) setNotice("This message is no longer available");
      });
    return () => {
      alive = false;
    };
  }, [focusMessageId, conversation, endpoint, sessionToken]);
  useEffect(() => {
    if (focusedMessage)
      document
        .getElementById(`message-${focusedMessage}`)
        ?.scrollIntoView({ block: "center" });
  }, [focusedMessage]);
  const older = async () => {
    if (loadingOlder) return;
    setLoadingOlder(true);
    try {
      const element = scrollRef.current;
      const height = element?.scrollHeight || 0;
      const result = await localApi<{
        messages: LocalChatMessage[];
        hasMore: boolean;
      }>(`${endpoint}&before=${messages[0]?.createdAt}`, sessionToken);
      stickRef.current = false;
      setMessages((current) => [...result.messages, ...current]);
      setHasMore(result.hasMore);
      requestAnimationFrame(() => {
        if (element) element.scrollTop = element.scrollHeight - height;
      });
    } catch (error) {
      setNotice(
        errorText(error, "Could not load messages"),
      );
    } finally {
      setLoadingOlder(false);
    }
  };
  const change = async (id: string, patch: object) => {
    try {
      await localApi(endpoint, sessionToken, {
        method: "PATCH",
        json: { id, ...patch },
      });
      await refresh();
    } catch (error) {
      setNotice(
        errorText(error, "Could not update message"),
      );
    }
  };
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (
      !canWrite ||
      sendLock.current ||
      uploadLock.current ||
      (!body.trim() && !attachments.length)
    )
      return;
    sendLock.current = true;
    setSending(true);
    setNotice("");
    try {
      if (editing) {
        await localApi(endpoint, sessionToken, {
          method: "PATCH",
          json: { id: editing.id, body },
        });
        setEditing(null);
      } else
        await localApi(endpoint, sessionToken, {
          method: "POST",
          json: {
            body,
            attachmentIds: attachments.map((f) => f.id),
            references: references.filter(r => activeTags.referenceIds.has(r.id)),
            mentionUserIds: [...activeTags.mentionIds],
            replyTo: reply?.id,
          },
        });
      if (!editing) drafts.delete(draftKey);
      if (!alive.current) return;
      setBody(editing ? drafts.get(draftKey) || "" : "");
      setTrigger(null);
      setAttachments([]);
      setReferences([]);
      setMentions([]);
      setReply(null);
      stickRef.current = true;
      await refresh();
    } catch (error) {
      setNotice(errorText(error, "Message failed"));
    } finally {
      sendLock.current = false;
      if (alive.current) setSending(false);
    }
  };
  const upload = async (files: FileList | File[]) => {
    if (!canWrite || editing || uploadLock.current || sendLock.current) return;
    uploadLock.current = true;
    setUploading(true);
    setNotice("");
    try {
      for (const file of Array.from(files).slice(0, 8 - attachments.length)) {
        if (file.size > 15 * 1024 * 1024)
          throw new Error(`${file.name} exceeds 15 MB`);
        const form = new FormData();
        form.set("file", file);
        const result = await localApi<{ file: ChatAttachment }>(
          `/api/local-chat/files?${scope}`,
          sessionToken,
          { method: "POST", body: form },
        );
        if (/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
          const url = URL.createObjectURL(file);
          setPreviews(current => ({ ...current, [result.file.id]: url }));
        }
        setAttachments((current) => [...current, result.file]);
      }
    } catch (error) {
      setNotice(errorText(error, "Upload failed"));
    } finally {
      uploadLock.current = false;
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };
  const filtered = (searchText ? searchResults : messages).filter(m => !pinnedOnly || m.pinned);
  return (
    <section
      className="chat-thread"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length && canWrite) {
          e.preventDefault();
          void upload(e.dataTransfer.files);
        }
      }}
    >
      {conversation && (
        <div className="dm-recipient">
          <button
            className="icon-button dm-back"
            aria-label="Back to direct messages"
            onClick={onBack}
          >
            <ArrowLeft size={17} />
          </button>
          <button
            className="dm-recipient-profile"
            disabled={!recipient}
            onClick={() => recipient && openMember(recipient.email)}
          >
            <UserAvatar
              user={recipient || { name: "Former member" }}
              size="small"
            />
            <strong>
              {recipient ? memberName(recipient) : "Former member"}
            </strong>
          </button>
        </div>
      )}
      <div
        className="conversation"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          if (stickRef.current) {
            setNewBelow(false);
            void markRead(messages.at(-1)).catch(() => {});
          }
        }}
      >
        {(loading || (searching && !searchResults.length)) && (
          <ContentSkeleton kind="chat" label="Loading messages" rows={6} />
        )}
        {!searchText && hasMore && (
          <button
            className="load-earlier"
            disabled={loadingOlder}
            onClick={older}
          >
            {loadingOlder ? "Loading..." : "Load earlier messages"}
          </button>
        )}
        {searchText && moreResults && <button className="load-earlier" disabled={searching} onClick={olderSearchResults}>{searching ? "Searching..." : "Earlier results"}</button>}
        {!loading && !searching && !filtered.length && (
          <div className="chat-empty">
            <MessageCircle size={32} />
            <h2>
              {query || pinnedOnly
                ? "No messages found"
                : conversation
                  ? `Message ${recipient ? memberName(recipient) : "this teammate"}`
                  : "Start a conversation"}
            </h2>
          </div>
        )}
        {filtered.map((message, index) => {
          const member = members?.find(
            (m) =>
              m.userId === message.authorUserId ||
              m.email.toLowerCase() === message.authorEmail.toLowerCase(),
          );
          const identity =
            message.authorUserId === user._id ||
            message.authorEmail.toLowerCase() === user.email.toLowerCase()
              ? user
              : member || {
                  name: message.authorName,
                  email: message.authorEmail,
                  avatarUrl: message.avatarUrl,
                };
          const name = memberName(identity);
          const previous = filtered[index - 1];
          const newDay =
            !previous ||
            new Date(previous.createdAt).toDateString() !==
              new Date(message.createdAt).toDateString();
          const replyMessage = messages.find((m) => m.id === message.replyTo);
          return (
            <Fragment key={message.id}>
              {newDay && (
                <div className="chat-day">
                  <span>{dayLabel(message.createdAt)}</span>
                </div>
              )}
              <article
                id={`message-${message.id}`}
                className={`conversation-message ${message.id === focusedMessage ? "notification-focus" : ""}`}
                tabIndex={-1}
              >
                <button
                  className="chat-profile-avatar"
                  disabled={!member}
                  aria-label={`View ${name} profile`}
                  onClick={() => member && openMember(member.email)}
                >
                  <UserAvatar user={identity} />
                </button>
                <div className="message-content">
                  <header>
                    <button
                      className="chat-profile-name"
                      disabled={!member}
                      onClick={() => member && openMember(member.email)}
                    >
                      {name}
                    </button>
                    <time
                      dateTime={new Date(message.createdAt).toISOString()}
                      title={formatDateTime(message.createdAt)}
                    >
                      {formatTime(message.createdAt)}
                    </time>
                    {message.editedAt && <small>edited</small>}
                    {message.pinned && <Pin size={12} />}
                  </header>
                  {replyMessage && (
                    <button
                      className="message-reply-preview"
                      onClick={() =>
                        document
                          .getElementById(`message-${replyMessage.id}`)
                          ?.scrollIntoView({
                            block: "center",
                            behavior: "smooth",
                          })
                      }
                    >
                      <Reply size={12} />
                      <strong>{nameOf(replyMessage)}</strong>
                      <span>{replyMessage.body || "Attachment"}</span>
                    </button>
                  )}
                  <p className="chat-message-text">{chatMessageParts(message.body, message.mentions, message.references).map((part, index) => {
                    if (part.kind === "link") return <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a>;
                    if (part.kind === "mention") {
                      const target = members?.find(member => member.userId === part.mention.userId);
                      return <button key={index} type="button" className="chat-inline-tag" disabled={!target} onClick={() => target && openMember(target.email)}>{target ? `@${displayName(target)}` : part.text}</button>;
                    }
                    if (part.kind === "reference") return <button key={index} type="button" className="chat-inline-tag chat-inline-reference" onClick={() => onOpenReference(part.reference.projectId as Id<"projects">, part.reference.type === "issue" ? part.reference.id as Id<"tasks"> : undefined)}>{part.text}</button>;
                    return <Fragment key={index}>{part.text}</Fragment>;
                  })}</p>
                  {message.attachments?.length ? (
                    <div className="message-files">
                      {message.attachments.map((file) => (
                        <LocalAttachment
                          key={file.id}
                          file={file}
                          sessionToken={sessionToken}
                          scope={scope}
                        />
                      ))}
                    </div>
                  ) : null}
                  <div className="message-reactions">
                    {Object.entries(message.reactions || {})
                      .filter(([, ids]) => ids.length)
                      .map(([reaction, ids]) => (
                        <button
                          key={reaction}
                          className={ids.includes(user._id) ? "selected" : ""}
                          disabled={!canWrite}
                          onClick={() => change(message.id, { reaction })}
                        >
                          {reaction === "like" ? (
                            <ThumbsUp size={12} />
                          ) : reaction === "heart" ? (
                            <Heart size={12} />
                          ) : reaction === "celebrate" ? (
                            <Smile size={12} />
                          ) : (
                            <Check size={12} />
                          )}
                          {ids.length}
                        </button>
                      ))}
                  </div>
                </div>
                {canWrite && (
                  <div className="message-tools">
                    <button title="Create issue from message" aria-label="Create issue from message" onClick={() => setIssueMessage(message)}><CirclePlus size={14} /></button>
                    <button
                      title="Copy message"
                      aria-label="Copy message"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(message.body);
                          setCopied(message.id);
                        } catch {
                          setNotice("Could not copy message");
                        }
                      }}
                    >
                      {copied === message.id ? (
                        <Check size={14} />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                    <button
                      title="Reply"
                      aria-label="Reply"
                      onClick={() => {
                        setReply(message);
                        if (editing) setBody(drafts.get(draftKey) || "");
                        setEditing(null);
                        inputRef.current?.focus();
                      }}
                    >
                      <Reply size={14} />
                    </button>
                    <button
                      title="Like"
                      aria-label="Like"
                      onClick={() => change(message.id, { reaction: "like" })}
                    >
                      <ThumbsUp size={14} />
                    </button>
                    <button
                      title={message.pinned ? "Unpin message" : "Pin message"}
                      aria-label="Pin message"
                      onClick={() =>
                        change(message.id, { pinned: !message.pinned })
                      }
                    >
                      <Pin size={14} />
                    </button>
                    {message.authorUserId === user._id && (
                      <>
                        <button
                          aria-label="Edit message"
                          title="Edit message"
                          onClick={() => {
                            setEditing(message);
                            setReply(null);
                            setBody(message.body);
                            inputRef.current?.focus();
                          }}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          aria-label="Delete message"
                          title="Delete message"
                          onClick={() => {
                            if (window.confirm("Delete this message?"))
                              void change(message.id, { delete: true });
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </article>
            </Fragment>
          );
        })}
      </div>
      {newBelow && (
        <button className="new-messages" onClick={scrollBottom}>
          <ArrowDown size={14} />
          New messages
        </button>
      )}
      {notice && (
        <div className="notice danger" role="alert">
          {notice}
          <button
            className="icon-button"
            aria-label="Dismiss"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <form className="rich-composer" onSubmit={submit}>
        {trigger && (
          <div
            className="chat-suggestions"
            id="chat-suggestions"
            role="listbox"
            aria-label={
              trigger.kind === "member" ? "Teammates" : "Projects and issues"
            }
          >
            {suggestions.loading && !suggestions.options.length ? (
              <ContentSkeleton
                kind="chat"
                rows={2}
                label="Loading suggestions"
              />
            ) : (
              suggestions.options.map((option, index) => (
                <button
                  key={option.key}
                  id={`chat-suggestion-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeSuggestion}
                  disabled={
                    option.member
                      ? !activeTags.mentionIds.has(option.member.userId!) && activeTags.mentionIds.size >= 20
                      : Boolean(option.reference && !activeTags.referenceIds.has(option.reference.id) && activeTags.referenceIds.size >= 12)
                  }
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseSuggestion(option)}
                >
                  {option.member ? (
                    <UserAvatar
                      user={
                        option.member.userId === user._id ? user : option.member
                      }
                    />
                  ) : option.reference?.type === "project" ? (
                    <Hash size={18} />
                  ) : (
                    <Circle size={17} />
                  )}
                  <span className="suggestion-copy">
                    <strong>{option.label}</strong>
                    <small>{option.detail}</small>
                  </span>
                </button>
              ))
            )}
            {!suggestions.loading && !suggestions.options.length && (
              <div className="suggestion-empty">No matches</div>
            )}
            {suggestions.loadMore && (
              <button
                type="button"
                className="suggestion-more"
                onClick={suggestions.loadMore}
              >
                More issues
              </button>
            )}
          </div>
        )}
        {(reply || editing) && (
          <div className="composer-context">
            <Reply size={14} />
            <span>
              {editing
                ? "Editing your message"
                : `Replying to ${reply ? nameOf(reply) : ""}`}
            </span>
            <button
              type="button"
              aria-label="Cancel"
              onClick={() => {
                if (editing) setBody(drafts.get(draftKey) || "");
                setReply(null);
                setEditing(null);
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((file) => (
              <span key={file.id} className={previews[file.id] ? "composer-image" : undefined} title={previews[file.id] ? file.name : undefined}>
                {previews[file.id] ? <img src={previews[file.id]} alt={file.name} /> : <><File size={13} />{file.name}</>}
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter((f) => f.id !== file.id),
                    )
                  }
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="chat-composer-input">
        <div ref={highlightsRef} className="chat-composer-highlights" aria-hidden="true">{draftParts.map((part, index) => part.kind === "mention" || part.kind === "reference" ? <mark key={index} className={part.kind === "reference" ? "reference-highlight" : undefined}>{part.text}</mark> : <Fragment key={index}>{part.text}</Fragment>)}{"\n"}</div>
        <textarea
          ref={inputRef}
          autoFocus={canWrite && !focusMessageId}
          data-initial-focus={canWrite && !focusMessageId ? true : undefined}
          aria-label={conversation ? "Direct message" : "Message the team"}
          value={body}
          onScroll={(event) => { if (highlightsRef.current) highlightsRef.current.scrollTop = event.currentTarget.scrollTop; }}
          onChange={(e) => {
            setBody(e.target.value);
            updateTrigger(e.target.value, e.target.selectionStart);
          }}
          onClick={(e) =>
            updateTrigger(e.currentTarget.value, e.currentTarget.selectionStart)
          }
          onBlur={(e) => {
            if (!e.currentTarget.closest("form")?.contains(e.relatedTarget))
              setTrigger(null);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (trigger) {
              if (e.key === "Escape") {
                e.preventDefault();
                setTrigger(null);
                return;
              }
              if (["ArrowDown", "ArrowUp"].includes(e.key)) {
                e.preventDefault();
                const count = suggestions.options.length;
                if (count)
                  setSuggestionIndex(
                    (activeSuggestion +
                      (e.key === "ArrowDown" ? 1 : -1) +
                      count) %
                      count,
                  );
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (suggestions.options[activeSuggestion])
                  chooseSuggestion(suggestions.options[activeSuggestion]);
                return;
              }
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                setTrigger(null);
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          aria-autocomplete="list"
          aria-controls={trigger ? "chat-suggestions" : undefined}
          aria-activedescendant={
            trigger && suggestions.options.length
              ? `chat-suggestion-${activeSuggestion}`
              : undefined
          }
          onPaste={(e) => {
            const files = e.clipboardData.files;
            if (files.length && canWrite) {
              e.preventDefault();
              void upload(files);
            }
          }}
          placeholder={
            !online ? "Reconnect to send a message" : canWrite
              ? conversation
                ? `Message ${recipient ? memberName(recipient) : "teammate"}`
                : "Message the team"
              : "You have view-only access"
          }
          disabled={!canWrite || sending}
          rows={1}
          maxLength={8000}
        />
        </div>
        <footer>
          <div>
            <input
              ref={uploadRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) void upload(e.target.files);
              }}
            />
            <button
              type="button"
              className="icon-button"
              aria-label="Attach files"
              title={!online ? RECONNECT_TO_CREATE : "Attach files"}
              disabled={
                !canWrite ||
                uploading ||
                sending ||
                Boolean(editing) ||
                attachments.length >= 8
              }
              onClick={() => uploadRef.current?.click()}
            >
              {uploading ? (
                <Loader2 size={17} className="spin" />
              ) : (
                <Paperclip size={17} />
              )}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Tag a project or issue"
              title="Tag a project or issue"
              disabled={!canWrite || sending || Boolean(editing)}
              onClick={() => openSuggestions("#")}
            >
              <Hash size={17} />
            </button>
            {!conversation && (
              <button
                type="button"
                className="icon-button"
                aria-label="Mention a teammate"
                title="Mention a teammate"
                disabled={!canWrite || sending || Boolean(editing)}
                onClick={() => openSuggestions("@")}
              >
                <AtSign size={17} />
              </button>
            )}
          </div>
          <button
            className="send-message"
            title={!online ? RECONNECT_TO_CREATE : editing ? "Save message" : "Send message"}
            aria-label={editing ? "Save message" : "Send message"}
            disabled={
              !canWrite ||
              sending ||
              uploading ||
              (!body.trim() && !attachments.length)
            }
          >
            {sending ? (
              <Loader2 className="spin" size={16} />
            ) : editing ? (
              <Check size={16} />
            ) : (
              <ArrowUp size={19} strokeWidth={2.2} />
            )}
          </button>
        </footer>
      </form>
      {issueMessage && projects && <IssueComposer sessionToken={sessionToken} projects={projects} activeProjectId={null} initialDraft={{ title: issueMessage.body.split("\n")[0].slice(0, 250) || "Follow up on chat", description: `${issueMessage.body}\n\nFrom ${nameOf(issueMessage)}, ${formatDateTime(issueMessage.createdAt)}` }} onClose={() => setIssueMessage(null)} onCreated={onOpenReference} />}
    </section>
  );
}
