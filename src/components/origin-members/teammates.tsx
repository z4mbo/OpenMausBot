import { useMemo } from "react";
import { useCloudQuery, useCloudSession } from "@/lib/origin-cloud";
import { useWorkspaceMembers } from "@/lib/origin-members";
import type { MentionTeammate } from "../Composer";
import { MemberAvatar } from "./MemberAvatar";

type Person = { userId?: string; name: string; username?: string; email: string; avatarUrl?: string | null };

export type Teammate = MentionTeammate & { userId: string };

export function teammatesFrom(people: readonly Person[] | undefined, self: string | undefined, only?: string): Teammate[] {
  return (people ?? []).flatMap((person) => !person.userId || person.userId === self || (only !== undefined && person.userId !== only) ? [] : [{
    id: person.userId,
    userId: person.userId,
    name: person.username || person.name,
    avatar: <MemberAvatar person={person} className="size-6 text-[10px]" />,
    kind: "Teammate",
    ...(person.username && person.name !== person.username ? { description: person.name } : {}),
  }]);
}

/** The people who can read a chat in this project, or in the whole workspace when there is no project; never yourself.
 * `only` narrows it to one person, the other side of a direct conversation. */
export function useTeammates({ teamId, projectId, only }: { teamId?: string | null; projectId?: string | null; only?: string }): Teammate[] {
  const workspace = useWorkspaceMembers(projectId ? null : teamId ?? null);
  const project = useCloudQuery<Person[]>("members:people", projectId ? { projectId } : "skip");
  const self = useCloudSession().user?._id;
  const people = projectId ? project : workspace;
  return useMemo(() => teammatesFrom(people, self, only), [people, self, only]);
}
