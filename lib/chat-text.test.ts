import { expect, test } from "vitest";
import { chatMessageParts, chatTextParts } from "./chat-text";
import { chatTrigger, insertChatTag } from "./chat-composer";

test("PG2 O-071: only HTTP links are active and HTML remains literal text", () => {
  const body = '<script>alert(1)</script> javascript:alert(1) ftp://example.test/file https://example.test/safe';
  const parts = chatTextParts(body);
  expect(parts.filter(part => part.kind === "link")).toEqual([{ kind: "link", text: "https://example.test/safe", href: "https://example.test/safe" }]);
  expect(parts.map(part => part.text).join("")).toBe(body);
});
test("PG2 O-071 O-075: selected tags preserve surrounding text and URL token boundaries", () => {
  const text = 'Before @pe';
  const trigger = chatTrigger(text, text.length)!;
  const inserted = insertChatTag(text, trigger, 'peer');
  expect(inserted.text).toBe('Before @peer ');
  const mention = { userId: 'peer' as never, name: 'peer' };
  expect(chatTextParts('https://example.test/@peer @peer', [mention]).map(part => part.kind)).toEqual(['link', 'text', 'mention']);
  expect(chatMessageParts('Legacy body', [mention]).at(-1)).toMatchObject({ kind: 'mention', text: '@peer' });
});
