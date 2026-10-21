import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";

const fixture = await launchVerificationServer();
// Synthetic test values in the disposable data directory: X is connected and has an extra "Founder" account, Studio
// generation is not. Nothing here is a real key.
writeFileSync(join(fixture.info.dataDir, "integration-keys.json"), JSON.stringify({
  x: { apiKey: "fixture", apiSecret: "fixture", accessToken: "fixture", accessSecret: "fixture" },
}), { mode: 0o600 });
writeFileSync(join(fixture.info.dataDir, "broadcast-accounts.json"), JSON.stringify({ accounts: [
  { id: "acct-founder-x", integration: "x", label: "Founder", values: { apiKey: "fixture", apiSecret: "fixture", accessToken: "fixture", accessSecret: "fixture" }, createdAt: 1 },
] }), { mode: 0o600 });
const fakes = fileURLToPath(new URL("./testing/origin-integrations-fakes.ts", import.meta.url));
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  preview = await mountPreview(fixture, { entry: "/scripts/testing/origin-integrations-preview.tsx", route: "/__origin-integrations.html", title: "Isolated Origin Integrations", aliases: [
    { find: /^@\/lib\/(?:origin-github|use-origin-workspace|origin-members|origin-project-state|origin-cloud(?:\/client)?)$/, replacement: fakes },
    { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
  ] });
  console.log(JSON.stringify({ ...fixture.info, previewUrl: preview.previewUrl }));
  await parkUntilSignal();
} finally { await preview?.close(); await fixture.close(); }
