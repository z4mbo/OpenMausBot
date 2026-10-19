import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { cloudUrl, setCloudUrl, useCloudSession } from "@/lib/origin-cloud";
import { captureCloudSession, isCurrentCloudSession, sessionStore } from "@/lib/origin-cloud/client";
import { originServerFor } from "@/lib/origin-cloud/servers";
import { CenteredDialog } from "./CenteredDialog";
import { ghostButton, iconButton, inputClass, primaryButton } from "./origin-pages/ui";

const DEV_URL = "http://127.0.0.1:3210";

/** Shares the signed-in Origin session with the harness, so bots can reach their project's issues, assets and repo. */
export async function shareSession(url: string | null, sessionToken: string | null, attempt?: ReturnType<typeof captureCloudSession>) {
  if (!sessionToken || !url) {
    if (!sessionStore.get()) await fetch("/api/origin/cloud-session", { method: "DELETE" }).catch(() => {});
    return;
  }
  if (attempt) {
    attempt.assertCurrent();
    if (attempt.url !== url) throw new Error("Your Origin connection changed. Try again.");
  } else if (!isCurrentCloudSession(url, sessionToken)) return;
  const response = await fetch("/api/origin/cloud-session", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, sessionToken }),
  });
  if (!response.ok) throw new Error(`Origin could not connect this account (HTTP ${response.status})`);
}

export function OriginConnectDialog({ onClose }: { onClose(): void }) {
  const titleId = useId();
  const session = useCloudSession();
  const [url, setUrl] = useState(cloudUrl() ?? DEV_URL);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const field = `${inputClass} mt-1.5`;

  const signIn = async () => {
    setBusy(true); setError("");
    try {
      const backend = originServerFor(url);
      setCloudUrl(backend);
      await session.login(email.trim(), password);
      await shareSession(backend, sessionStore.get());
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
    <CenteredDialog label="Origin account" labelledBy={titleId} onClose={onClose} className="p-5 sm:max-w-[420px]">{(dismiss) => <>
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="text-[16px] font-semibold text-ink">Origin account</h2>
          <button type="button" aria-label="Close" onClick={dismiss} className={iconButton}><X size={16} /></button>
        </div>
        {session.user ? (
          <div className="space-y-4">
            <p className="break-words text-[13px] text-ink-secondary">Signed in as <span className="font-medium text-ink">{session.user.name || session.user.email}</span> on {cloudUrl()}.</p>
            <button type="button" disabled={busy} onClick={() => void signOut()}
              className={ghostButton}>Sign out</button>
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
            <button type="submit" disabled={busy || !email || !password}
              className={`${primaryButton} w-full`}>
              {busy && <Loader2 size={14} className="animate-spin" />}Sign in
            </button>
          </form>
        )}
        {error && <p role="alert" className="mt-3 text-[12.5px] text-danger">{error}</p>}
      </>}</CenteredDialog>,
    document.body,
  );
}
