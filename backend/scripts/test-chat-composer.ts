import assert from "node:assert/strict";
import { chatTrigger, insertChatTag } from "../lib/chat-composer";

assert.deepEqual(chatTrigger("hello @sam", 10), { kind: "member", query: "sam", start: 6, end: 10 });
assert.deepEqual(chatTrigger("#Origin", 7), { kind: "reference", query: "Origin", start: 0, end: 7 });
assert.equal(chatTrigger("alex@example.com", 16), null);
assert.equal(chatTrigger("https://example.com/#section", 28), null);
assert.equal(chatTrigger("@sam hello", 10), null);
assert.equal(chatTrigger("plain text", 10), null);
assert.equal(chatTrigger("hello\n#issue", 12)?.kind, "reference");
assert.equal(chatTrigger("(@sam", 5)?.start, 1);
const mid = chatTrigger("Hello @sa, can you review?", 9)!;
assert.deepEqual(insertChatTag("Hello @sa, can you review?", mid, "sam"), { text: "Hello @sam , can you review?", cursor: 11 });
assert.deepEqual(insertChatTag("#Web", chatTrigger("#Web", 4)!, "Website redesign"), { text: "#Website redesign ", cursor: 18 });
console.log("Chat composer tests passed: token boundaries, email/URL exclusion, caret replacement, project names.");
