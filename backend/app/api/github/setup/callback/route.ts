import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_OWNER_EMAIL } from "@/convex/lib/auth";
import { getConvexClient, requireLocalUser } from "@/lib/localRealtime";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { consumeGithubState, githubAppConfig, saveGitHubApp, type GithubState } from "@/lib/github-workspace";
import { originUrl } from "@/lib/integration-bridge";

export const runtime = "nodejs";
async function requireSetupAdmin(state: GithubState) {
  const user = await requireLocalUser(state.sessionToken);
  const access = await getConvexClient().query(api.workspaces.access, { sessionToken: state.sessionToken, teamId: state.teamId as Id<"teams"> });
  if (user._id !== state.userId || user.email !== DEFAULT_OWNER_EMAIL || !["owner", "admin"].includes(access.role) || githubAppConfig()) throw new Error("Setup unavailable");
}
export async function GET(request: NextRequest) {
  try {
    const state = consumeGithubState(request.nextUrl.searchParams.get("state") || "", request.cookies.get("origin.github")?.value || "", "setup");
    await requireSetupAdmin(state);
    const code = request.nextUrl.searchParams.get("code"); if (!code || !/^[a-zA-Z0-9]+$/.test(code)) throw new Error("Invalid setup code");
    const response = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, { method: "POST", headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(15000) });
    const app = await response.json();
    if (!response.ok || !app.client_id || !app.client_secret || !app.slug || !app.webhook_secret) throw new Error("GitHub App setup failed");
    await requireSetupAdmin(state);
    saveGitHubApp({ clientId: app.client_id, clientSecret: app.client_secret, slug: app.slug, webhookSecret: app.webhook_secret, appId: app.id, privateKey: app.pem });
    return NextResponse.redirect(`${originUrl()}/${encodeURIComponent(state.slug)}?github=app-ready`);
  } catch { return NextResponse.redirect(`${originUrl()}/?github=setup-failed`); }
}
