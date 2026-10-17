import { useState } from "react";
import { ArrowLeft, Hash, MessageSquarePlus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useWorkspaceMembers, type WorkspaceMember } from "@/lib/origin-members";
import { originRealtime, usePolled, type MemberChatMessage } from "@/lib/origin-realtime";
import { errorText } from "./repo-url";
import { TeamChat } from "./TeamChatPage";
import { Loading, Notice, iconButton, inputClass, type WorkspaceContext } from "./ui";
import { PersonAvatar } from "./PersonAvatar";

type DirectConversation = { id: string; otherUserId: string; lastMessage?: MemberChatMessage; unread: number };

const CONVERSATIONS = "/api/local-chat/conversations";
const LIST_POLL_MS = 4_000;
const WORKSPACE_CHANNEL = "";

const memberLabel = (member: Pick<WorkspaceMember, "name" | "username" | "email">) => member.username || member.name || member.email;

export function WorkspaceChat({ teamId, me, canEdit }: WorkspaceContext) {
  const members = useWorkspaceMembers(teamId);
  const { value: conversations, error, refresh } = usePolled(
    () => originRealtime<{ conversations: DirectConversation[] }>(CONVERSATIONS, { teamId }).then((result) => result.conversations),
    LIST_POLL_MS, teamId,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState("");
  const others = (members ?? []).filter((member) => member.userId && member.userId !== me._id);
  const memberOf = (userId: string) => members?.find((member) => member.userId === userId);
  const active = selected ?? WORKSPACE_CHANNEL;
  const activeDm = conversations?.find((conversation) => conversation.id === active);
  const activeMember = activeDm ? memberOf(activeDm.otherUserId) : undefined;
  const activeName = active === WORKSPACE_CHANNEL ? "the workspace" : activeMember ? memberLabel(activeMember) : "this conversation";

  const startConversation = async (member: WorkspaceMember) => {
    setNotice("");
    try {
      const result = await originRealtime<{ conversationId: string }>(CONVERSATIONS, { teamId }, { json: { recipientId: member.userId } });
      setPicking(false);
      setSelected(result.conversationId);
      refresh();
    } catch (reason) {
      setNotice(errorText(reason, "Could not open the conversation"));
    }
  };

  const row = "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink-secondary hover:bg-raised/60 hover:text-ink";

  return (
    <div className="flex min-h-0 flex-1">
      <aside aria-label="Conversations" className={cn("w-full shrink-0 flex-col gap-1 overflow-y-auto border-r border-hairline/40 p-2 md:flex md:w-64", selected === null ? "flex" : "hidden")}>
        <button type="button" className={cn(row, active === WORKSPACE_CHANNEL && "bg-raised text-ink")} aria-current={active === WORKSPACE_CHANNEL ? "page" : undefined}
          onClick={() => setSelected(WORKSPACE_CHANNEL)}>
          <Hash size={15} aria-hidden="true" />Workspace
        </button>
        <div className="mt-3 flex items-center justify-between px-2">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-tertiary">Direct messages</h2>
          <button type="button" className={iconButton} aria-label="New message" title="New message" aria-expanded={picking} disabled={!canEdit} onClick={() => setPicking(!picking)}>
            {picking ? <X size={14} /> : <MessageSquarePlus size={14} />}
          </button>
        </div>
        {picking && (
          <MemberPicker members={others} onPick={(member) => void startConversation(member)} />
        )}
        {notice && <Notice tone="danger">{notice}</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}
        {conversations === undefined && !error && <div className="px-2"><Loading label="Loading conversations" variant="inline" /></div>}
        {conversations?.length === 0 && !picking && <p className="px-2 py-1 text-[12.5px] text-ink-tertiary">No direct messages yet.</p>}
        {conversations?.map((conversation) => {
          const member = memberOf(conversation.otherUserId);
          const last = conversation.lastMessage;
          return (
            <button key={conversation.id} type="button" className={cn(row, "items-start", active === conversation.id && "bg-raised text-ink")}
              aria-current={active === conversation.id ? "page" : undefined} onClick={() => setSelected(conversation.id)}>
              <PersonAvatar person={member ?? { email: "?", name: "Former member" }} size={26} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1">
                  <span className="truncate font-medium text-ink">{member ? memberLabel(member) : "Former member"}</span>
                  {conversation.unread > 0 && <span className="ml-auto rounded-full bg-accent px-1.5 text-[10.5px] font-semibold text-accent-ink" aria-label={`${conversation.unread} unread messages`}>{conversation.unread}</span>}
                </span>
                <span className="block truncate text-[12px] text-ink-tertiary">
                  {last ? last.body || (last.attachments?.length ? "Attachment" : "") : "Start a conversation"}
                </span>
              </span>
            </button>
          );
        })}
      </aside>
      <div className={cn("min-w-0 flex-1 flex-col", selected === null ? "hidden md:flex" : "flex")}>
        <div className="flex items-center gap-2 border-b border-hairline/40 px-3 py-2">
          <button type="button" className={cn(iconButton, "md:hidden")} aria-label="All conversations" onClick={() => setSelected(null)}><ArrowLeft size={15} /></button>
          {active === WORKSPACE_CHANNEL ? <Hash size={15} className="text-ink-secondary" aria-hidden="true" /> : activeMember && <PersonAvatar person={activeMember} size={22} />}
          <h2 className="truncate text-[14px] font-semibold text-ink">{active === WORKSPACE_CHANNEL ? "Workspace" : activeName}</h2>
        </div>
        <TeamChat key={active} target={{ teamId, conversation: active }} name={activeName} me={me} canWrite={canEdit} markRead
          emptyTitle={active === WORKSPACE_CHANNEL ? "Start the workspace conversation" : `Say hello to ${activeName}`}
          emptyBody={active === WORKSPACE_CHANNEL ? "Messages here are shared with everyone in this workspace." : "Only the two of you can see this conversation."}
          readOnlyNote="You have view-only access to this workspace." />
      </div>
    </div>
  );
}

function MemberPicker({ members, onPick }: { members: WorkspaceMember[]; onPick(member: WorkspaceMember): void }) {
  const [query, setQuery] = useState("");
  const shown = members.filter((member) => `${member.name} ${member.username ?? ""} ${member.email}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-hairline/40 bg-panel p-1.5">
      <input className={inputClass} type="search" placeholder="Find a member" aria-label="Find a member" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} />
      {shown.length === 0 && <p className="px-1 py-1 text-[12px] text-ink-tertiary">{members.length ? "Nobody matches" : "Invite people to this workspace to message them."}</p>}
      {shown.map((member) => (
        <button key={member._id} type="button" onClick={() => onPick(member)}
          className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] text-ink hover:bg-raised">
          <PersonAvatar person={member} size={20} /><span className="min-w-0 flex-1 truncate">{memberLabel(member)}</span>
        </button>
      ))}
    </div>
  );
}
