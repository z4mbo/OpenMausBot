import { fileURLToPath } from "node:url";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";

const fixture = await launchVerificationServer();
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
