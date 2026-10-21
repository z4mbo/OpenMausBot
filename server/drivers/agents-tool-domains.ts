// Origin's domain sections, whose tools a turn may list in short with find_tool for the whole definition. A tool joins
// its section by its name's prefix, so a new Studio, Broadcast, Canvas, Pages, Campaign or Standup tool is
// deferred without being listed anywhere else.

export interface DeferredToolDomain {
  prefix: string;
  /** What a person asking for one of these tools says; find_tool ranks with them, and they are never sent. */
  words: string;
  /** The same, for one tool of the section. */
  tools?: Readonly<Record<string, string>>;
}

export const DEFERRED_TOOL_DOMAINS: readonly DeferredToolDomain[] = [
  { prefix: "origin_studio_", words: "image picture photo illustration logo artwork thumbnail video clip animation audio voice voiceover music sound generate make create render",
    tools: { origin_studio_workflow_list: "workflow workflows pipeline template templates node graph", origin_studio_workflow_run: "run workflow template reel avatar podcast chain steps campaign pack", origin_studio_library: "character characters product style library consistent reference", origin_studio_presets: "preset presets effect effects motion transfer try-on relight angle higgsfield comfyui" } },
  { prefix: "origin_broadcast_", words: "social media post tweet twitter publish share announce linkedin instagram bluesky facebook tiktok",
    tools: { origin_broadcast_draft: "write compose", origin_broadcast_list: "scheduled queued posts" } },
  { prefix: "origin_canvas", words: "mockup wireframe layout ui screen frame",
    tools: { origin_canvas_edit: "design build draw create make change section hero pricing landing" } },
  { prefix: "origin_campaign_", words: "campaign launch marketing promotion" },
  { prefix: "origin_brand_", words: "brand kit identity colours colors palette fonts typography voice tone style guide" },
  { prefix: "origin_standup", words: "standup daily update status report" },
  { prefix: "origin_call_", words: "call meeting recap summary notes minutes action items decisions follow-ups what did we decide" },
  { prefix: "origin_milestone_", words: "milestone roadmap mvp launch deadline target date progress plan" },
];

export function deferredToolDomain(name: string): DeferredToolDomain | undefined {
  return DEFERRED_TOOL_DOMAINS.find((domain) => name.startsWith(domain.prefix));
}

export function deferredToolWords(name: string): string | undefined {
  const domain = deferredToolDomain(name);
  return domain && [domain.words, domain.tools?.[name]].filter(Boolean).join(" ");
}

export function isDeferredTool(name: string): boolean {
  return deferredToolDomain(name) !== undefined;
}
