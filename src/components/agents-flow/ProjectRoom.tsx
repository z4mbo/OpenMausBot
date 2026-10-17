import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { missingMembers, projectRoomBulletin, projectRoomOf, projectRoster, workspaceHeadOf } from "@/lib/agents-flow";
import { api, useStore, type Bot, type Group } from "@/state/store";
import { useCloudSession } from "@/lib/origin-cloud";
import { useCloudWorkspaceFor } from "@/lib/origin-cloud-links";
import { useWorkspaceMembers } from "@/lib/origin-members";
import type { MentionTeammate } from "../Composer";
import { GroupView } from "../GroupView";
import { MemberAvatar } from "../origin-members";
import { ghostButton } from "../origin-pages/ui";

const opening = new Set<string>();

function useProjectRoom(lead: Bot, agents: readonly Bot[]) {
  const { state, dispatch } = useStore();
  const head = workspaceHeadOf(state.bots, lead);
  const room = projectRoomOf(state.groups, lead);
  const roster = projectRoster(head, lead, agents);
  const [error, setError] = useState("");
  const syncing = useRef("");

  const create = () => {
    if (opening.has(lead.id)) return;
    opening.add(lead.id);
    setError("");
    api<{ group: Group }>("/api/groups", {
      method: "POST",
      body: JSON.stringify({
        memberIds: roster,
        name: `${lead.name} team`,
        section: lead.section,
        setup: { bulletin: projectRoomBulletin(head, lead, agents), defaultResponder: { kind: "member", botId: lead.id } },
      }),
    })
      .then(({ group }) => dispatch({ type: "groupPatched", group }))
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => opening.delete(lead.id));
  };
  const latestCreate = useRef(create);
  latestCreate.current = create;
  const absent = state.hydrated && !room;
  useEffect(() => {
    if (absent) latestCreate.current();
  }, [absent]);

  const missing = room ? missingMembers(room, roster) : [];
  const missingKey = missing.join(",");
  useEffect(() => {
    if (!room || !missingKey || syncing.current === `${room.id}:${missingKey}`) return;
    syncing.current = `${room.id}:${missingKey}`;
    dispatch({ type: "patchGroup", groupId: room.id, patch: { memberIds: [...room.memberIds, ...missingKey.split(",")] } });
  }, [room, missingKey, dispatch]);

  useEffect(() => {
    if (!room?.unread) return;
    api(`/api/groups/${room.id}/read`, { method: "POST" }).catch(() => {});
    dispatch({ type: "groupPatched", group: { id: room.id, unread: false } });
  }, [room?.id, room?.unread, dispatch]);

  return { room, error, retry: create };
}

function useTeammates(lead: Bot): MentionTeammate[] {
  const members = useWorkspaceMembers(useCloudWorkspaceFor(lead) ?? null);
  const self = useCloudSession().user?._id;
  return useMemo(() => (members ?? []).flatMap((member) => !member.userId || member.userId === self ? [] : [{
    id: member.userId,
    name: member.username || member.name,
    avatar: <MemberAvatar person={member} className="size-6 text-[10px]" />,
    kind: "Teammate",
    description: member.username && member.name !== member.username ? member.name : undefined,
  }]), [members, self]);
}

export function ProjectRoom({ lead, agents, headerEnd }: { lead: Bot; agents: readonly Bot[]; headerEnd: ReactNode }) {
  const { room, error, retry } = useProjectRoom(lead, agents);
  const people = useTeammates(lead);
  if (room) return <GroupView key={room.id} group={room} managed headerEnd={headerEnd} people={people} />;
  return (
    <div data-project-room className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center justify-end gap-1.5 px-5">{headerEnd}</div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-[13px] text-ink-secondary">
        {error ? (
          <>
            <p className="max-w-sm text-danger">{error}</p>
            <button type="button" className={ghostButton} onClick={retry}>Try again</button>
          </>
        ) : <Loader2 size={18} className="motion-safe:animate-spin" aria-label="Opening the team room" />}
      </div>
    </div>
  );
}
