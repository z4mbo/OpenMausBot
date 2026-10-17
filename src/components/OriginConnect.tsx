import { useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { cloudUrl, setCloudUrl, useCloudSession } from "@/lib/origin-cloud";
import { sessionStore } from "@/lib/origin-cloud/client";
import { cn } from "@/lib/cn";

const DEV_URL = "http://127.0.0.1:3210";

/** Shares the signed-in Origin session with the harness, so bots can reach their project's issues, assets and repo. */
export async function shareSession(url: string | null, sessionToken: string | null) {
  await fetch("/api/origin/cloud-session", sessionToken && url
    ? { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, sessionToken }) }
    : { method: "DELETE" }).catch(() => {});
}

export function OriginConnectDialog({ onClose }: { onClose(): void }) {
  const session = useCloudSession();
  const [url, setUrl] = useState(cloudUrl() ?? DEV_URL);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const field = "mt-1.5 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink outline-none focus:border-focus";

  const signIn = async () => {
    setBusy(true); setError("");
    try {
      setCloudUrl(url.trim() || null);
      await session.login(email.trim(), password);
      await shareSession(url.trim(), sessionStore.get());
      setPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const signOut = async () => {
    setBusy(true);
    try { await session.logout(); await shareSession(null, null); } finally { setBusy(false); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Origin account" className="w-full max-w-[420px] rounded-2xl border border-hairline/50 bg-panel p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-ink">Origin account</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="flex size-8 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink"><X size={16} /></button>
        </div>
        {session.user ? (
          <div className="space-y-4">
            <p className="text-[13px] text-ink-secondary">Signed in as <span className="font-medium text-ink">{session.user.name || session.user.email}</span> on {cloudUrl()}.</p>
            <button type="button" disabled={busy} onClick={() => void signOut()}
              className="rounded-lg bg-raised px-4 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50">Sign out</button>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void signIn(); }}>
            <label className="block text-[12.5px] text-ink-secondary">Origin backend URL
              <input className={field} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://your-deployment.convex.cloud" />
            </label>
            <label className="block text-[12.5px] text-ink-secondary">Email
              <input className={field} type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label className="block text-[12.5px] text-ink-secondary">Password
              <input className={field} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
            <button type="submit" disabled={busy || !email || !password}
              className={cn("flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40")}>
              {busy && <Loader2 size={14} className="animate-spin" />}Sign in
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
