"use client";

import { useEffect, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { localApi } from "@/lib/client-api";
import { useWorkspace } from "./workspace-context";

export type LocalVoiceParticipant = {
  userId: Id<"users">;
  name: string;
  username?: string;
  email: string;
  avatarUrl?: string | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing?: boolean;
  joinedAt: number;
  lastSeenAt: number;
};

/** Who is in the workspace call, polled every 3 s (the sidebar count and the Call view). */
export function useLocalVoiceParticipants(sessionToken: string | null, enabled = true) {
  const workspace = useWorkspace();
  const [participants, setParticipants] = useState<LocalVoiceParticipant[] | undefined>(undefined);
  useEffect(() => {
    if (!sessionToken || !enabled) {
      setParticipants(undefined);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const result = await localApi<{ participants: LocalVoiceParticipant[] }>(`/api/local-voice/participants?teamId=${workspace._id}`, sessionToken);
        if (alive) setParticipants(result.participants);
      } catch {
        if (alive) setParticipants(current => current ?? []);
      }
    };
    void load();
    const interval = window.setInterval(load, 3_000);
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [enabled, sessionToken, workspace._id]);
  return participants;
}
