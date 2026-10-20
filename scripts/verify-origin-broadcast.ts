import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";

const fixture = await launchVerificationServer();
// Synthetic test values in the disposable data directory, so X and Bluesky read as connected and the rest as not.
writeFileSync(join(fixture.info.dataDir, "integration-keys.json"), JSON.stringify({
  x: { apiKey: "fixture", apiSecret: "fixture", accessToken: "fixture", accessSecret: "fixture" },
  bluesky: { handle: "fixture.bsky.social", appPassword: "fixture-fixture" },
}), { mode: 0o600 });
const cloud = fileURLToPath(new URL("./testing/origin-broadcast-cloud.ts", import.meta.url));
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  preview = await mountPreview(fixture, { entry: "/scripts/testing/origin-broadcast-preview.tsx", route: "/__origin-broadcast.html", title: "Isolated Origin Broadcast", aliases: [
    { find: /^@\/lib\/origin-cloud(?:\/client)?$/, replacement: cloud },
    { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
  ] });
  console.log(JSON.stringify({ ...fixture.info, previewUrl: preview.previewUrl }));
  await parkUntilSignal();
} finally { await preview?.close(); await fixture.close(); }
