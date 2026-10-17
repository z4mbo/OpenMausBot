import { fileURLToPath } from "node:url";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";
const fixture = await launchVerificationServer();
const cloud = fileURLToPath(new URL("./testing/origin-draw-cloud.ts", import.meta.url));
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  preview = await mountPreview(fixture, { entry: "/scripts/testing/origin-draw-preview.tsx", route: "/__origin-draw.html", title: "Isolated Origin drawing", aliases: [
    { find: /^@\/lib\/origin-cloud(?:\/client)?$/, replacement: cloud },
    { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
  ] });
  console.log(JSON.stringify({ ...fixture.info, previewUrl: preview.previewUrl }));
  await parkUntilSignal();
} finally { await preview?.close(); await fixture.close(); }
