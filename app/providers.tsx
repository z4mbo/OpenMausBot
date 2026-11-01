"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode, useMemo } from "react";

function MissingConvexUrl() {
  return (
    <main className="setup-screen">
      <section className="setup-card">
        <div className="brand-mark">O</div>
        <h1>Connect Convex</h1>
        <p>Run Convex CLI, then restart Next dev server.</p>
        <pre>npx convex dev</pre>
        <p className="muted">This creates <code>.env.local</code> with <code>NEXT_PUBLIC_CONVEX_URL</code>.</p>
      </section>
    </main>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const convex = useMemo(() => (convexUrl ? new ConvexReactClient(convexUrl) : null), [convexUrl]);

  if (!convexUrl || !convex) return <MissingConvexUrl />;

  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
