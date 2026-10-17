import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";

const fixture = await launchVerificationServer();
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  preview = await mountPreview(fixture, {
    entry: "/scripts/testing/origin-ui-preview.tsx", route: "/__origin-ui.html", title: "Origin isolated UI verification",
    extraRoutes: [{ path: "/api/local-chat/messages", handler: async (req, res) => {
      if (req.method === "POST") await new Promise((resolve) => setTimeout(resolve, 2_000));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ messages: [], hasMore: false }));
    } }],
  });
  console.log(JSON.stringify({ ...fixture.info, previewUrl: preview.previewUrl }));
  await parkUntilSignal();
} finally {
  await preview?.close();
  await fixture.close();
}
