// Origin's domain sections, whose tools a turn may list in short with find_tool for the whole definition. A tool joins
// its section by its name's prefix, so a new tool of a section is deferred without being listed anywhere else.

export interface DeferredToolDomain {
  prefix: string;
  /** What a person asking for one of these tools says; find_tool ranks with them, and they are never sent. */
  words: string;
  /** The same, for one tool of the section. */
  tools?: Readonly<Record<string, string>>;
}

export const DEFERRED_TOOL_DOMAINS: readonly DeferredToolDomain[] = [
  { prefix: "origin_brand_", words: "brand kit identity colours colors palette fonts typography voice tone style guide" },
  { prefix: "origin_standup", words: "standup daily update status report" },
  { prefix: "origin_call_", words: "call meeting recap summary notes minutes action items decisions follow-ups what did we decide" },
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
