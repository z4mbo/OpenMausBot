import { describe, expect, it } from "vitest";
import { applyCanvasOps } from "./canvas-ops.ts";
import { pageDocument, pageSlug, renderCanvasPage, leadFormHeight } from "./canvas-page.ts";
import { sanitizeNode, type CanvasNode } from "./canvas-scene.ts";

function scene(node: Record<string, unknown>) {
  const { changed, created } = applyCanvasOps(new Map(), [{ op: "create", node }]);
  return { scene: new Map(changed.map((item) => [item.id, item] as [string, CanvasNode])), root: created[0]!.id, created };
}

describe("renderCanvasPage", () => {
  it("turns auto layout into flexbox that reflows, with one h1 and escaped text", () => {
    const { scene: nodes, root } = scene({
      type: "frame", w: 1440, fill: "#101014", layout: { direction: "row", gap: 32, padding: [96, 120], align: "center", justify: "between", hug: "height" },
      children: [
        { type: "text", text: "Big <idea>", fontSize: 72, fill: "#FFFFFF" },
        { type: "text", text: "Second headline", fontSize: 40 },
        { type: "rect", w: 200, h: 100, fill: "#FF0000", grow: true, link: "javascript:alert(1)" },
      ],
    });
    const page = renderCanvasPage(nodes, root, new Map())!;
    expect(page.body).toMatch(/^<main style="width:100%;max-width:1440px;margin:0 auto;background:#101014;[^"]*display:flex;flex-direction:row;flex-wrap:wrap;gap:clamp\(16px,2.22vw,32px\);padding:clamp\(16px,6.67vw,96px\) clamp\(16px,8.33vw,120px\)/);
    expect(page.body).toContain("align-items:center;justify-content:space-between");
    expect(page.body).toMatch(/<h1 class="o-t"[^>]*font-size:clamp\(43.2px,5vw,72px\)[^>]*>Big &lt;idea&gt;<\/h1>/);
    expect(page.body).toMatch(/<h2 class="o-t"[^>]*>Second headline<\/h2>/);
    expect(page.body).toMatch(/flex:1 1 min\(\d+px,240px\);min-width:0;height:100px;background:#FF0000/);
    expect(page.body).not.toContain("javascript");
    expect(page).toMatchObject({ background: "#101014", fonts: ["sans"], leadForms: 0 });
  });

  it("scales a frame without auto layout as one board and keeps links and images", () => {
    const { scene: nodes, root } = scene({
      type: "frame", w: 800, h: 400, fill: "#FFFFFF",
      children: [
        { type: "text", x: 40, y: 40, text: "Hi", fontSize: 32, autoWidth: true },
        { type: "image", x: 400, y: 0, w: 400, h: 400, fileId: "img1" },
        { type: "rect", x: 40, y: 300, w: 160, h: 48, fill: "#000000", link: "https://example.com/?a=1&b=2" },
      ],
    });
    const page = renderCanvasPage(nodes, root, new Map([["img1", "https://cdn.example/a.png"]]))!;
    expect(page.body).toContain("aspect-ratio:800/400;background:#FFFFFF;overflow:hidden;position:relative;container-type:inline-size");
    expect(page.body).toContain("position:absolute;left:5cqw;top:5cqw");
    expect(page.body).toContain("font-size:4cqw");
    expect(page.body).toContain('<img src="https://cdn.example/a.png" alt="Image" loading="lazy"');
    expect(page.body).toContain('<a href="https://example.com/?a=1&amp;b=2"');
  });

  it("renders a lead form frame as a posting form and reports the submission in the document", () => {
    const { scene: nodes, root, created } = scene({
      type: "frame", w: 600, fill: "#0B0B0F", layout: { direction: "column", hug: "height" },
      children: [{ type: "frame", w: 400, fill: null, leadForm: { fields: ["phone", "message"], button: "Call me", accent: "#22C55E" } }],
    });
    const form = nodes.get(created[1]!.id)!;
    expect(form).toMatchObject({ leadForm: { fields: ["phone", "message"], button: "Call me", accent: "#22C55E" }, height: leadFormHeight(form.leadForm!) });
    expect(form.layout).toBeUndefined();
    const page = renderCanvasPage(nodes, root, new Map())!;
    expect(page.leadForms).toBe(1);
    expect(page.body).toContain('<form method="post" id="lead" class="o-form"');
    expect(page.body).toContain('<input type="tel" name="phone" autocomplete="tel" maxlength="320" placeholder="Phone" aria-label="Phone" required');
    expect(page.body).toContain('<textarea name="message"');
    expect(page.body).toContain('name="website" tabindex="-1"');
    expect(page.body).toContain("background:#22C55E;color:#111111");
    const html = pageDocument({ title: "A & B", description: "Desc", url: "https://x.test/p/a/b", image: "https://x.test/og.png", page, status: "sent" });
    expect(html).toContain("<title>A &amp; B</title>");
    expect(html).toContain('<meta property="og:image" content="https://x.test/og.png">');
    expect(html).toContain('<body class="o-page o-sent">');
    expect(html).toContain("Thanks, we will be in touch.");
    expect(pageDocument({ title: "t", description: "", page, status: null })).not.toContain("Thanks");
  });

  it("keeps a contact field in every lead form and only frames publish", () => {
    expect(sanitizeNode({ id: "f", type: "frame", version: 1, versionNonce: 1, leadForm: { fields: ["name", "message"] } })?.leadForm).toEqual({ fields: ["name", "email", "message"], button: "Submit", accent: null });
    expect(sanitizeNode({ id: "r", type: "rect", version: 1, versionNonce: 1, leadForm: { fields: ["email"] } })?.leadForm).toBeUndefined();
    const { scene: nodes, created } = scene({ type: "frame", children: [{ type: "text", text: "x" }] });
    expect(renderCanvasPage(nodes, created[1]!.id, new Map())).toBeNull();
  });

  it("makes addresses from titles", () => {
    expect(pageSlug("  Join the Waitlist — Café! ")).toBe("join-the-waitlist-cafe");
    expect(pageSlug("x".repeat(60))).toHaveLength(48);
  });
});
