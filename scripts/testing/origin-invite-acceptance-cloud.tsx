import { useSyncExternalStore, type AnchorHTMLAttributes, type ReactNode } from "react";
import st from "../../site/components/site.module.css";

export const api = { workspaces: { invitePreview: "preview", acceptInvite: "accept", list: "workspaces" }, auth: { login: "login", signup: "signup", signupMode: "signupMode" } };
type Invitation = { name: string; email: string; role: string };
const initialInvitation = (): Invitation => ({ name: "Synthetic workspace", email: "member@example.test", role: "member" });
let invitation: Invitation | null = initialInvitation();
let account = 1;
let generation = 1;
let revision = 0;
let mutationCalls = 0;
let pending: { resolve(value: { slug: string }): void; reject(error: Error): void } | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => revision;
const publish = () => { revision++; for (const listener of listeners) listener(); };
const useFixtureRevision = () => useSyncExternalStore(subscribe, snapshot);

export function useOriginSession() {
  useFixtureRevision();
  return { loading: false, token: `synthetic-session-${generation}-${account}`, user: { _id: `synthetic-user-${account}`, name: "Synthetic member", email: account === 1 ? "member@example.test" : "other@example.test" }, save: () => {}, signOut: async () => { account++; publish(); } };
}
export function useQuery(name: string) {
  useFixtureRevision();
  if (name === "preview") return invitation;
  if (name === "signupMode") return { inviteOnly: true };
  return [];
}
export const useAction = () => async () => { throw new Error("Synthetic login and registration are disabled"); };
export const useMutation = () => () => {
  mutationCalls++;
  if (pending) throw new Error("A synthetic acceptance is already pending");
  const promise = new Promise<{ slug: string }>((resolve, reject) => { pending = { resolve, reject }; });
  publish();
  return promise;
};
export function useAcceptanceFixture() {
  useFixtureRevision();
  return {
    mutationCalls, pending: pending !== null, previewAvailable: invitation !== null,
    invalidate() { invitation = null; publish(); },
    resolve() { const active = pending; pending = null; active?.resolve({ slug: "synthetic-workspace" }); publish(); },
    reject() { const active = pending; pending = null; active?.reject(new Error("Synthetic invitation permission denied")); publish(); },
    switchAccount() { account++; publish(); },
    reset() { pending?.reject(new Error("Synthetic fixture reset")); pending = null; invitation = initialInvitation(); account = 1; generation++; mutationCalls = 0; publish(); },
  };
}
export function SiteFrame({ children }: { children: ReactNode; signedIn?: boolean; minimal?: boolean }) { return <div className={st.site}>{children}</div>; }
export function DownloadCard(_props: { name?: string; compact?: boolean }) { return <aside style={{ padding: 16, border: "1px solid var(--line)", borderRadius: 8 }}>Synthetic download card · no download action</aside>; }
export default function Link({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) { return <a {...props} href="#synthetic-navigation" data-original-href={href} onClick={event => event.preventDefault()} onAuxClick={event => event.preventDefault()}>{children}</a>; }
