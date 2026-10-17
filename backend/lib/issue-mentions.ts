export function mentionToken(person: { username?: string; name: string }) {
  return `@${person.username || person.name}`;
}

export function containsMention(body: string, token: string) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_/@#.-])${escaped}(?![\\p{L}\\p{N}_/@#-]|\\.[\\p{L}\\p{N}])`, "u").test(body);
}
