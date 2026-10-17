"use client";

import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ChatTrigger } from "@/lib/chat-composer";
import type { ChatReference } from "@/lib/localRealtime";
import type { ChatMember } from "./chat-shell";
import { memberName } from "./user-avatar";

export type ChatSuggestion = { key: string; label: string; detail: string; member?: ChatMember; reference?: ChatReference };

export function useChatSuggestions(trigger: ChatTrigger | null, members: ChatMember[] | undefined, sessionToken: string, teamId: Id<"teams">) {
  const referencing = trigger?.kind === "reference";
  const projects = useQuery(api.projects.listForUser, referencing ? { sessionToken, teamId } : "skip");
  const issues = usePaginatedQuery(api.inbox.list, referencing ? { sessionToken, teamId, mine: false, done: false } : "skip", { initialNumItems: 100 });
  const query = trigger?.query.toLowerCase() || "";
  let options: ChatSuggestion[] = [];
  if (trigger?.kind === "member") {
    options = (members || []).filter(m => m.userId && `${m.name} ${m.username || ""} ${m.email}`.toLowerCase().includes(query)).slice(0, 8).map(member => ({ key: member.userId!, label: memberName(member), detail: member.name, member }));
  } else if (referencing) {
    const projectMatches: ChatSuggestion[] = (projects || []).filter(p => p.name.toLowerCase().includes(query)).slice(0, 5).map(p => ({ key: p._id, label: p.name, detail: "Project", reference: { type: "project", id: p._id, projectId: p._id, label: p.name } }));
    const issueMatches: ChatSuggestion[] = issues.results.filter(t => `${t.title} ${t.projectName} ORI-${t._id.slice(-4)}`.toLowerCase().includes(query)).slice(0, 8 - projectMatches.length).map(t => ({ key: t._id, label: t.title, detail: `${t.projectName} · ORI-${t._id.slice(-4).toUpperCase()}`, reference: { type: "issue", id: t._id, projectId: t.projectId, label: t.title } }));
    options = [...projectMatches, ...issueMatches];
  }
  return { options, loading: trigger?.kind === "member" ? members === undefined : referencing && (projects === undefined || issues.status === "LoadingFirstPage" || issues.status === "LoadingMore"), loadMore: referencing && issues.status === "CanLoadMore" ? () => issues.loadMore(100) : undefined };
}
