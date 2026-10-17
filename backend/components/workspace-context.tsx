"use client";

import { createContext, useContext } from "react";
import type { Id } from "@/convex/_generated/dataModel";

export type Workspace = { _id: Id<"teams">; name: string; slug: string; role: string };
export const WorkspaceContext = createContext<Workspace | null>(null);
export const MemberProfileContext = createContext<(email: string) => void>(() => {});
export const useMemberProfile = () => useContext(MemberProfileContext);
export function useWorkspace() {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("Select a workspace");
  return workspace;
}
