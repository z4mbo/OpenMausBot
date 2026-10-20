import { PAGE_SLUG, pageSlug } from "../shared/canvas-page.ts";
import { childrenIndex } from "../shared/canvas-scene.ts";
import { canvasesOf, pickCanvas, sceneOf, type CanvasToolProject } from "./origin-canvas-tools.ts";

type Args = Record<string, unknown>;

const text = (value: unknown) => (typeof value === "string" ? value : "");
const record = (value: unknown): Args => (value && typeof value === "object" && !Array.isArray(value) ? value as Args : {});

export async function publishPage(args: Args, project: CanvasToolProject) {
  if (!project.canEdit) project.refuse(`The Origin sign-in only views ${project.name}, so it cannot publish its pages.`);
  const canvases = await canvasesOf(project);
  const wantedCanvas = text(args.canvas).trim();
  const canvas = wantedCanvas ? pickCanvas(project, canvases, wantedCanvas)
    : canvases.length === 1 ? canvases[0]! : project.refuse(`Pass canvas: ${project.name} has ${canvases.length || "no"} canvases.`);
  const canvasId = text(canvas._id);
  const scene = await sceneOf(project, canvasId);
  const frames = (childrenIndex(scene).get(null) ?? []).filter((node) => node.type === "frame");
  const wantedFrame = text(args.frame).trim();
  const frame = frames.find((node) => node.id === wantedFrame) ?? scene.get(wantedFrame) ?? frames.find((node) => node.name.trim().toLowerCase() === wantedFrame.toLowerCase());
  if (!frame || frame.deleted || frame.type !== "frame") {
    project.refuse(`No frame ${wantedFrame.slice(0, 80) || "given"} on "${text(canvas.name)}"; its top-level frames: ${frames.map((node) => `"${node.name}" (${node.id})`).join(", ") || "none"}.`);
  }
  const title = text(args.title).trim() || frame.name;
  const slug = pageSlug(text(args.slug).trim() || title);
  if (!PAGE_SLUG.test(slug)) project.refuse("Give slug as lowercase letters, numbers and hyphens, like waitlist.");
  const result = record(await project.client.mutation("pages:publish", {
    sessionToken: project.sessionToken, projectId: project.projectId, canvasId, frameId: frame.id, slug, title,
    ...(text(args.description).trim() ? { description: text(args.description).trim() } : {}),
  }));
  const forms = Number(result.leadForms) || 0;
  return {
    text: [
      `${result.created ? "Published" : "Republished"} "${title}" from frame "${frame.name}" at ${text(result.url)}.`,
      forms ? `Its lead form files submissions in ${project.name}'s Pipeline with source "${slug}".${result.captureTurnedOn ? " Lead capture was off and is on now." : ""}` : "It has no lead form; mark a frame as one with leadForm to collect leads.",
    ].join(" "),
  };
}

export async function listPages(_args: Args, project: CanvasToolProject) {
  const data = record(await project.client.query("pages:list", { sessionToken: project.sessionToken, projectId: project.projectId }));
  const pages = Array.isArray(data.pages) ? data.pages.map(record) : [];
  if (!pages.length) return { text: `${project.name} has no published pages; origin_page_publish publishes a canvas frame.` };
  const lines = pages.map((page) => `- "${text(page.title)}" ${text(page.url)} · ${Number(page.views) || 0} views · ${Number(page.leads) || 0} leads${Number(page.leadForms) ? "" : " (no form)"} · canvas ${text(page.canvasId)} frame ${text(page.frameId)}`);
  return { text: `${project.name}'s published pages (${pages.length}):\n${lines.join("\n")}${data.captureEnabled ? "" : "\nLead capture is off in Pipeline, so their forms do not accept submissions."}` };
}
