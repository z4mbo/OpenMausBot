/** A project's documents: the Brief and the specs people and agents edit as markdown. */
export const DOC_LIMITS = { title: 160, content: 60_000, tags: 12, tag: 40, perProject: 200, agentName: 80 } as const;

export const BRIEF_TAG = "brief";
export const BRIEF_TITLE = "Brief";

/** Who saved a document last; `agent` marks a save an agent made with the person's session. */
export interface DocEditor { name: string; agent: boolean }

export interface ProjectDocSummary {
  _id: string;
  title: string;
  tags: string[];
  excerpt: string;
  updatedAt: number;
  editedBy?: DocEditor;
}

export interface ProjectDoc extends ProjectDocSummary { content: string }

export interface ProjectDocList { canEdit: boolean; docs: ProjectDocSummary[] }

/** Part of the error a save raises when someone else saved the document after `baseUpdatedAt`. */
export const DOC_CHANGED = "changed since you opened it";

export const isBrief = (doc: { tags: readonly string[] }) => doc.tags.includes(BRIEF_TAG);

export function cleanTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

export interface ChecklistItem { line: number; done: boolean; text: string }

const CHECKLIST = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*)$/;

const FENCE = /^\s*(`{3,}|~{3,})/;

/** The markdown task-list items (`- [ ] text`) of a document, by line; code blocks hold none. */
export function checklistItems(markdown: string): ChecklistItem[] {
  let fenced = false;
  return markdown.split("\n").flatMap((source, line) => {
    if (FENCE.test(source)) fenced = !fenced;
    const match = fenced ? null : CHECKLIST.exec(source);
    return match ? [{ line, done: match[2] !== " ", text: match[4]!.trim() }] : [];
  });
}

export function toggleChecklistItem(markdown: string, line: number): string {
  const lines = markdown.split("\n");
  const match = CHECKLIST.exec(lines[line] ?? "");
  if (!match) return markdown;
  lines[line] = `${match[1]}${match[2] === " " ? "x" : " "}${match[3]}${match[4]}`;
  return lines.join("\n");
}
