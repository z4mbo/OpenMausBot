"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode, useMemo } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const convex = useMemo(() => (convexUrl ? new ConvexReactClient(convexUrl) : null), [convexUrl]);
  if (!convex) return <main>Origin is not configured: NEXT_PUBLIC_CONVEX_URL is missing from this build.</main>;
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
