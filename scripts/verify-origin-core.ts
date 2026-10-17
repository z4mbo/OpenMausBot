import { launchVerificationServer, runControlOmb } from "./control-omb.ts";
import { mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";

const fixture = await launchVerificationServer();
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  await runControlOmb(["new-bot", "--name", "Atlas", "--url", fixture.info.url]);
  await runControlOmb(["new-bot", "--name", "Juniper", "--url", fixture.info.url]);
  preview = await mountPreview(fixture, {
    entry: "/scripts/testing/threads-preview.tsx", route: "/__origin-core.html", title: "Origin isolated core verification",
  });
  console.log(JSON.stringify({ ...fixture.info, previewUrl: preview.previewUrl }));
  await parkUntilSignal();
} finally {
  await preview?.close();
  await fixture.close();
}
