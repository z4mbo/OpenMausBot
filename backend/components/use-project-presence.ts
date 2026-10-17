"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function useProjectPresence(sessionToken: string, teamId: Id<"teams">, projectId: Id<"projects"> | null) {
  const update = useMutation(api.projectPresence.update);
  const [now, setNow] = useState(() => Date.now());
  const rows = useQuery(api.projectPresence.list, { sessionToken, teamId, activeSince: Math.floor(now / 15_000) * 15_000 - 60_000 });
  const client = useRef({ id: "", sequence: 0 });
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!client.current.id) client.current.id = crypto.randomUUID();
    const clientId = client.current.id;
    const publish = (leave = false) => {
      void update({ sessionToken, teamId, clientId, sequence: ++client.current.sequence, projectId: !leave && document.visibilityState === "visible" ? projectId : null }).catch(() => { /* Presence expires if offline or access was revoked. */ });
    };
    const visibility = () => publish();
    const leave = () => publish(true);
    publish();
    const heartbeat = window.setInterval(() => { if (document.visibilityState === "visible" && projectId) publish(); }, 20_000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leave);
    return () => {
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [projectId, sessionToken, teamId, update]);
  return (rows || []).filter(row => row.updatedAt > now - 60_000);
}
