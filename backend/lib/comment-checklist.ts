export function checklistItem(line: string) {
  const match = /^\s*- \[([ xX])\] (.+)$/.exec(line);
  return match ? { checked: match[1].toLowerCase() === "x", text: match[2] } : null;
}

export function updateChecklist(body: string, lineIndex: number, expectedText: string, checked: boolean) {
  const lines = body.split("\n");
  const item = checklistItem(lines[lineIndex] || "");
  if (!Number.isInteger(lineIndex) || lineIndex < 0 || !item || item.text !== expectedText) throw new Error("Checklist changed. Refresh and try again.");
  lines[lineIndex] = lines[lineIndex].replace(/\[[ xX]\]/, checked ? "[x]" : "[ ]");
  return lines.join("\n");
}
