export type ChatTrigger = { kind: "member" | "reference"; query: string; start: number; end: number };

export function chatTrigger(text: string, cursor: number): ChatTrigger | null {
  const before = text.slice(0, cursor);
  const match = /(?:^|[\s(])([@#])([^\s@#]{0,80})$/u.exec(before);
  if (!match) return null;
  return { kind: match[1] === "@" ? "member" : "reference", query: match[2], start: cursor - match[2].length - 1, end: cursor };
}

export function insertChatTag(text: string, trigger: ChatTrigger, label: string) {
  const tag = `${trigger.kind === "member" ? "@" : "#"}${label} `;
  return { text: text.slice(0, trigger.start) + tag + text.slice(trigger.end), cursor: trigger.start + tag.length };
}
