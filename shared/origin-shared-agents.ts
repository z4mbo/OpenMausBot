/** The part of a bot every member of a workspace shares. Skills, peers, approvals, MCP servers and connectors stay per machine. */
export interface SharedDefinition {
  name: string;
  title: string;
  description: string;
  soul: string;
  color: string;
  mascotExpression?: string;
  mascotBody?: string;
  look?: { look?: "mascot" | "dot"; color?: string; face?: string };
}

type DefinitionSource = {
  name: string; title?: string; description?: string; soul?: string; color?: string;
  mascotExpression?: string | null; mascotBody?: string | null;
};

export function definitionOf(bot: DefinitionSource, look?: SharedDefinition["look"]): SharedDefinition {
  const cleanLook = look && (look.color || look.face || look.look === "dot") ? {
    ...(look.look ? { look: look.look } : {}), ...(look.color ? { color: look.color } : {}), ...(look.face ? { face: look.face } : {}),
  } : undefined;
  return {
    name: bot.name.trim(), title: (bot.title ?? "").trim(), description: (bot.description ?? "").trim(), soul: (bot.soul ?? "").trim(),
    color: bot.color ?? "green",
    ...(bot.mascotExpression ? { mascotExpression: bot.mascotExpression } : {}),
    ...(bot.mascotBody ? { mascotBody: bot.mascotBody } : {}),
    ...(cleanLook ? { look: cleanLook } : {}),
  };
}

/** FNV-1a over a canonical JSON form: equal definitions hash equal on every machine. */
export function definitionHash(definition: SharedDefinition): string {
  const canonical = JSON.stringify(definition, Object.keys(definition).sort().concat(["look", "color", "face"]));
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The fields a pull changes when someone else edited them and this member must look before the next run here. */
export function needsReview(local: SharedDefinition, cloud: SharedDefinition): boolean {
  return local.soul !== cloud.soul;
}

export function roleKeyFor(bot: { name: string; title?: string; chiefOfStaff?: boolean }, head = false): string {
  if (head) return "head";
  if (bot.chiefOfStaff) return "chief";
  const slug = (bot.title?.trim() || bot.name).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return slug || "agent";
}
