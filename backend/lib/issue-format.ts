export function formattedIssueText(response: string) {
  const text = response.trim().replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/, "$1").trim();
  if (!text || text.length > 60000) throw new Error("AI returned an empty or oversized description. Try again.");
  return text;
}
