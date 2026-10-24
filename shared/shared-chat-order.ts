import type { WireMessage } from "./wire.ts";

export function orderedSharedMessages<T extends Pick<WireMessage, "sharedMessage">>(messages: readonly T[]): T[] {
  return [...messages].sort((a, b) => (a.sharedMessage?.seq ?? Number.MAX_SAFE_INTEGER) - (b.sharedMessage?.seq ?? Number.MAX_SAFE_INTEGER));
}
