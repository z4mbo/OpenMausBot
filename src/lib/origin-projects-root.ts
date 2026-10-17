import { api } from "@/state/store";

/** GET returns the projects root; PUT `{ root: string | null }` sets it, null going back to the default. */
export const PROJECTS_ROOT_PATH = "/api/origin/projects-root";

export interface ProjectsRootChoice {
  label: string;
  path: string;
}

export interface ProjectsRoot {
  /** The folder holding one working folder per Origin project. */
  root: string;
  /** False while the default (Documents/Origin Projects) applies because nobody picked one. */
  chosen: boolean;
  suggestions: ProjectsRootChoice[];
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const path = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

export function folderName(folder: string): string {
  return folder.split(/[\\/]+/).filter(Boolean).at(-1) ?? folder;
}

/** Reads the server's answer: `{ root, chosen, suggestions }`, or `{ root, defaultRoot, desktopRoot }`. */
export function parseProjectsRoot(body: unknown): ProjectsRoot | null {
  const raw = record(body);
  const suggestions = Array.isArray(raw.suggestions)
    ? raw.suggestions.flatMap((item) => {
      const choice = record(item);
      const at = path(choice.path);
      return at ? [{ label: path(choice.label) ?? folderName(at), path: at }] : [];
    })
    : [
      ...(path(raw.defaultRoot) ? [{ label: "Documents", path: path(raw.defaultRoot)! }] : []),
      ...(path(raw.desktopRoot) ? [{ label: "Desktop", path: path(raw.desktopRoot)! }] : []),
    ];
  const chosenRoot = path(raw.root);
  const root = chosenRoot ?? path(raw.defaultRoot) ?? suggestions[0]?.path ?? null;
  if (!root) return null;
  const chosen = typeof raw.chosen === "boolean" ? raw.chosen : Boolean(chosenRoot);
  return { root, chosen, suggestions };
}

export function initialRoot(answer: ProjectsRoot | null): string | null {
  return answer?.root ?? null;
}

/** True when the selection is not yet what the server keeps, so the default is saved too. */
export function rootNeedsSaving(answer: ProjectsRoot | null, selected: string | null): boolean {
  if (!selected) return false;
  return !answer?.chosen || answer.root !== selected;
}

/** The suggestions, then the saved folder and a picked one when they are not among them. */
export function rootChoices(answer: ProjectsRoot | null, custom: string | null): ProjectsRootChoice[] {
  if (!answer) return custom ? [{ label: folderName(custom), path: custom }] : [];
  const choices = [...answer.suggestions];
  const add = (folder: string | null) => {
    if (folder && !choices.some((choice) => choice.path === folder)) choices.push({ label: folderName(folder), path: folder });
  };
  if (answer.chosen) add(answer.root);
  add(custom);
  return choices;
}

export async function getProjectsRoot(): Promise<ProjectsRoot | null> {
  return parseProjectsRoot(await api(PROJECTS_ROOT_PATH));
}

/** Creates the folder, gives every project its folder under it and returns the new state; null goes back to the default. */
export async function setProjectsRoot(root: string | null): Promise<ProjectsRoot | null> {
  return parseProjectsRoot(await api(PROJECTS_ROOT_PATH, { method: "PUT", body: JSON.stringify({ root }) }));
}
