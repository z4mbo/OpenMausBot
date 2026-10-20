import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";

const fixture = await launchVerificationServer();
// Synthetic test values in the disposable data directory: X, Bluesky and Meta read as connected, LinkedIn and TikTok's
// main account as not, and X and TikTok each have an extra "Founder" account the composer can post as.
writeFileSync(join(fixture.info.dataDir, "integration-keys.json"), JSON.stringify({
  x: { apiKey: "fixture", apiSecret: "fixture", accessToken: "fixture", accessSecret: "fixture" },
  bluesky: { handle: "origin.bsky.social", appPassword: "fixture-fixture" },
  meta: { pageAccessToken: "fixture", facebookPageId: "originhq" },
}), { mode: 0o600 });
writeFileSync(join(fixture.info.dataDir, "broadcast-accounts.json"), JSON.stringify({ accounts: [
  { id: "acct-founder-x", integration: "x", label: "Founder", values: { apiKey: "fixture", apiSecret: "fixture", accessToken: "fixture", accessSecret: "fixture" }, createdAt: 1 },
  { id: "acct-founder-tt", integration: "tiktok", label: "Founder", values: { accessToken: "fixture" }, createdAt: 2 },
] }), { mode: 0o600 });
const cloud = fileURLToPath(new URL("./testing/origin-broadcast-cloud.ts", import.meta.url));
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  preview = await mountPreview(fixture, { entry: "/scripts/testing/origin-broadcast-preview.tsx", route: "/__origin-broadcast.html", title: "Isolated Origin Publish", aliases: [
    { find: /^@\/lib\/origin-cloud(?:\/client)?$/, replacement: cloud },
    { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
  ] });
  console.log(JSON.stringify({ ...fixture.info, previewUrl: preview.previewUrl }));
  await parkUntilSignal();
} finally { await preview?.close(); await fixture.close(); }
