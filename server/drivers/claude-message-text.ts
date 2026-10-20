export function firstText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter(block => block?.type === "text" && block.text).map(block => block.text).join("");
  }
  return "";
}
