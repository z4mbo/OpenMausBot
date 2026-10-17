import { useEffect, useState, type FormEvent } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { cloudUrl, setCloudUrl, useCloudQuery, useCloudSession, type CloudWorkspace } from "@/lib/origin-cloud";
import { sessionStore } from "@/lib/origin-cloud/client";
import { Select } from "@/components/Select";
import { ghostButton, inputClass, primaryButton } from "@/components/origin-pages/ui";

type ConnectingApp = { name: string; domain: string; write: boolean; convexUrl: string | null };

export function OAuthConsentPage() {
  const query = location.search.slice(1);
  const session = useCloudSession();
  const [app, setApp] = useState<ConnectingApp | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [teamId, setTeamId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const workspaces = useCloudQuery<CloudWorkspace[]>("workspaces:list", session.user ? {} : "skip");

  useEffect(() => {
    fetch(`/api/mcp/authorize?${query}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as ConnectingApp & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Invalid authorization request");
        if (!cloudUrl() && body.convexUrl) setCloudUrl(body.convexUrl);
        if (!cloudUrl()) throw new Error("This app is not connected to Origin yet. Sign in to Origin in the app first.");
        setApp(body);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Invalid authorization request"));
  }, [query]);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await session.login(email, password);
      setPassword("");
    } catch {
      setError("Invalid email or password");
    } finally {
      setBusy(false);
    }
  };

  const consent = async (allow: boolean) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/mcp/authorize", {
        method: "POST",
        headers: { "content-type": "application/json", "x-origin-session": sessionStore.get() ?? "" },
        body: JSON.stringify({ query, teamId: teamId || workspaces?.[0]?._id, allow }),
      });
      const body = await response.json() as { url?: string; error?: string };
      if (!response.ok || !body.url) throw new Error(body.error ?? "Authorization failed");
      window.location.assign(body.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Authorization failed");
      setBusy(false);
    }
  };

  const signedIn = Boolean(session.user);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-app p-4 text-ink">
      <section aria-label="Connect an app to Origin" className="flex w-full max-w-sm flex-col gap-3 rounded-2xl border border-hairline/50 bg-panel p-6">
        <ShieldCheck size={26} className="text-accent-text" aria-hidden="true" />
        <h1 className="text-[18px] font-semibold">{app ? `Connect ${app.name}` : "Connect to Origin"}</h1>
        {app && <p className="text-[13px] text-ink-secondary">{app.domain}</p>}
        {app && !signedIn && session.ready && (
          <form className="flex flex-col gap-2" onSubmit={(event) => void signIn(event)}>
            <input className={inputClass} type="email" autoComplete="username" placeholder="Email" aria-label="Email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            <input className={inputClass} type="password" autoComplete="current-password" placeholder="Password" aria-label="Password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            <button className={primaryButton} disabled={busy}>Sign in to Origin</button>
          </form>
        )}
        {app && signedIn && workspaces && (
          <>
            <p className="text-[13px] text-ink-secondary">{session.user?.email}</p>
            <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-secondary">
              Workspace
              <Select value={teamId || workspaces[0]?._id || ""} onChange={(event) => setTeamId(event.target.value)}>
                {workspaces.map((workspace) => <option key={workspace._id} value={workspace._id}>{workspace.name}</option>)}
              </Select>
            </label>
            <ul className="list-disc space-y-1 pl-5 text-[13px] text-ink-secondary">
              <li>Read projects, issues, and member names</li>
              {app.write && <li>Create and change projects and issues</li>}
              <li>No access to vault secrets, chat, or GitHub tokens</li>
            </ul>
            <p className="text-[12px] text-ink-tertiary">Access expires in 90 days. Revoke it any time in Origin's settings.</p>
            <div className="flex justify-end gap-2">
              <button type="button" className={ghostButton} disabled={busy} onClick={() => void consent(false)}>Cancel</button>
              <button type="button" className={primaryButton} disabled={busy || !workspaces.length} onClick={() => void consent(true)}>
                {busy && <Loader2 size={14} className="animate-spin" />}Allow access
              </button>
            </div>
          </>
        )}
        {!error && (!app || (signedIn && !workspaces)) && <Loader2 size={18} className="animate-spin text-ink-secondary" aria-label="Loading" />}
        {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}
      </section>
    </main>
  );
}
