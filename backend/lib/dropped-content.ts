export function droppedLink(uriList: string, text: string): string | null {
  const candidate = uriList.split(/\r?\n/).find(line => line.trim() && !line.startsWith("#"))?.trim() || text.trim();
  try {
    const url = new URL(candidate);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function validateAttachmentFiles(files: { name: string; size: number }[]) {
  if (files.length > 8) throw new Error("Choose up to 8 files at a time");
  for (const file of files) if (!file.size || file.size > 15 * 1024 * 1024) throw new Error(`${file.name}: choose a file between 1 byte and 15 MB`);
}
