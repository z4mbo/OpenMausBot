// Origin's domain sections, whose tools a turn may list in short with find_tool for the whole definition. A tool joins
// its section by its name's prefix, so a new Studio, Broadcast, Pipeline, Canvas, Pages, Campaign or Standup tool is
// deferred without being listed anywhere else.

export interface DeferredToolDomain {
  prefix: string;
  /** What a person asking for one of these tools says; find_tool ranks with them, and they are never sent. */
  words: string;
  /** The same, for one tool of the section. */
  tools?: Readonly<Record<string, string>>;
}

export const DEFERRED_TOOL_DOMAINS: readonly DeferredToolDomain[] = [
  { prefix: "origin_studio_", words: "image picture photo illustration logo artwork thumbnail video clip animation audio voice voiceover music sound generate make create render" },
  { prefix: "origin_broadcast_", words: "social media post tweet twitter publish share announce linkedin instagram bluesky facebook tiktok",
    tools: { origin_broadcast_draft: "write compose" } },
  { prefix: "origin_pipeline_", words: "sales crm lead prospect customer client deal outreach follow-up",
    tools: { origin_pipeline_contact: "call phone ring email text message reach send" } },
  { prefix: "origin_canvas", words: "mockup wireframe layout ui screen frame",
    tools: { origin_canvas_edit: "design build draw create make change section hero pricing landing" } },
  { prefix: "origin_page_", words: "landing page website site web signup waitlist",
    tools: { origin_page_publish: "publish launch live put online" } },
  { prefix: "origin_campaign_", words: "campaign launch marketing promotion" },
  { prefix: "origin_standup", words: "standup daily update status report" },
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
