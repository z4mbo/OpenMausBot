"use client";

import { useEffect, useState } from "react";
import { ContentSkeleton } from "./content-skeleton";

/** A skeleton that only appears when loading takes longer than `delay`, so fast loads never flash. */
export function DelayedSkeleton({ delay = 200, ...props }: { delay?: number; kind?: "list" | "chat" | "board" | "canvas"; label?: string; rows?: number }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(true), delay);
    return () => window.clearTimeout(timer);
  }, [delay]);
  return shown ? <ContentSkeleton {...props} /> : <div className="pending-placeholder" role="status" aria-label={props.label || "Loading"} />;
}
