import * as Y from "yjs";
import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { canEdit, requireMember, touchProject } from "./lib/permissions";
import { cleanText } from "./lib/features";
import { BRIEF_TAG, DOC_CHANGED, DOC_LIMITS, cleanTags } from "../../shared/origin-docs";

type Page = Doc<"wikiPages">;

const editor = v.object({ name: v.string(), agent: v.boolean() });
const summary = { _id: v.id("wikiPages"), title: v.string(), tags: v.array(v.string()), excerpt: v.string(), updatedAt: v.number(), editedBy: v.optional(editor) };

/** Security: credential notes belong to the Vault; Docs, and the agents reading Docs, never see them. */
const isDoc = (page: Page) => page.type !== "credential_note";

const summaryOf = (page: Page) => ({
  _id: page._id, title: page.title, tags: page.tags, excerpt: page.content.slice(0, 180), updatedAt: page.updatedAt, ...(page.editedBy ? { editedBy: page.editedBy } : {}),
});

async function projectPage(ctx: QueryCtx | MutationCtx, projectId: Id<"projects">, docId: Id<"wikiPages">): Promise<Page | null> {
  const page = await ctx.db.get(docId);
  return page && page.projectId === projectId && isDoc(page) ? page : null;
}

async function requireEditor(ctx: MutationCtx, projectId: Id<"projects">, sessionToken: string) {
  const access = await requireMember(ctx, projectId, sessionToken);
  if (!canEdit(access.member)) throw new Error("Edit role required");
  return access;
}

function collaborationStateFor(page: Page, content: string): ArrayBuffer | undefined {
  if (!page.collaborationState) return undefined;
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, new Uint8Array(page.collaborationState));
    const text = doc.getText("content");
    doc.transact(() => { text.delete(0, text.length); text.insert(0, content); });
    const state = new Uint8Array(Y.encodeStateAsUpdate(doc)).buffer;
    if (state.byteLength > 700_000) throw new Error("Document size limit reached. Split it into smaller documents.");
    return state;
  } finally { doc.destroy(); }
}

export const list = query({
  args: { sessionToken: v.string(), projectId: v.id("projects") },
  returns: v.object({ canEdit: v.boolean(), docs: v.array(v.object(summary)) }),
  handler: async (ctx, args) => {
    const { member } = await requireMember(ctx, args.projectId, args.sessionToken);
    const pages = (await ctx.db.query("wikiPages").withIndex("by_project", (q) => q.eq("projectId", args.projectId)).take(DOC_LIMITS.perProject)).filter(isDoc);
    pages.sort((a, b) => Number(b.tags.includes(BRIEF_TAG)) - Number(a.tags.includes(BRIEF_TAG)) || b.updatedAt - a.updatedAt);
    return { canEdit: canEdit(member), docs: pages.map(summaryOf) };
  },
});

export const get = query({
  args: { sessionToken: v.string(), projectId: v.id("projects"), docId: v.id("wikiPages") },
  returns: v.union(v.null(), v.object({ ...summary, content: v.string() })),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const page = await projectPage(ctx, args.projectId, args.docId);
    return page ? { ...summaryOf(page), content: page.content } : null;
  },
});

export const save = mutation({
  args: {
    sessionToken: v.string(), projectId: v.id("projects"), docId: v.optional(v.id("wikiPages")),
    title: v.optional(v.string()), content: v.optional(v.string()), tags: v.optional(v.array(v.string())),
    /** The `updatedAt` the editor loaded; a later save by someone else refuses this one instead of overwriting it. */
    baseUpdatedAt: v.optional(v.number()),
    agentName: v.optional(v.string()),
  },
  returns: v.object({ docId: v.id("wikiPages"), updatedAt: v.number() }),
  handler: async (ctx, args) => {
    const { user, project } = await requireEditor(ctx, args.projectId, args.sessionToken);
    if (args.content !== undefined && args.content.length > DOC_LIMITS.content) throw new Error(`A document holds up to ${DOC_LIMITS.content.toLocaleString("en")} characters; split it.`);
    const tags = args.tags === undefined ? undefined : cleanTags(args.tags);
    if (tags && (tags.length > DOC_LIMITS.tags || tags.some((tag) => tag.length > DOC_LIMITS.tag))) throw new Error(`Up to ${DOC_LIMITS.tags} tags of ${DOC_LIMITS.tag} characters`);
    const agentName = args.agentName?.trim().slice(0, DOC_LIMITS.agentName);
    const editedBy = agentName ? { name: agentName, agent: true } : { name: user.name || user.email, agent: false };
    const now = Date.now();
    const existing = args.docId ? await projectPage(ctx, args.projectId, args.docId) : null;
    if (args.docId && !existing) throw new Error("Document not found");
    if (tags?.includes(BRIEF_TAG)) {
      const pages = await ctx.db.query("wikiPages").withIndex("by_project", (q) => q.eq("projectId", args.projectId)).take(DOC_LIMITS.perProject);
      if (pages.some((page) => page._id !== existing?._id && isDoc(page) && page.tags.includes(BRIEF_TAG))) throw new Error("This project already has a Brief; change that one instead.");
    }
    if (existing) {
      if (args.baseUpdatedAt !== undefined && existing.updatedAt !== args.baseUpdatedAt) {
        throw new Error(`"${existing.title}" ${DOC_CHANGED}${existing.editedBy ? ` (by ${existing.editedBy.name})` : ""}.`);
      }
      const content = args.content ?? existing.content;
      const collaborationState = args.content === undefined ? undefined : collaborationStateFor(existing, content);
      await ctx.db.patch(existing._id, {
        ...(args.title !== undefined ? { title: cleanText(args.title, DOC_LIMITS.title, "Title") } : {}),
        ...(args.content !== undefined ? { content } : {}),
        ...(collaborationState ? { collaborationState } : {}),
        ...(tags ? { tags } : {}),
        editedBy, updatedAt: now,
      });
      await touchProject(ctx, args.projectId);
      return { docId: existing._id, updatedAt: now };
    }
    const count = (await ctx.db.query("wikiPages").withIndex("by_project", (q) => q.eq("projectId", args.projectId)).take(DOC_LIMITS.perProject)).length;
    if (count >= DOC_LIMITS.perProject) throw new Error(`A project holds up to ${DOC_LIMITS.perProject} documents`);
    const docId = await ctx.db.insert("wikiPages", {
      teamId: project.teamId, projectId: args.projectId, title: cleanText(args.title ?? "", DOC_LIMITS.title, "Title"), content: args.content ?? "",
      type: "wiki", tags: tags ?? [], editedBy, createdAt: now, updatedAt: now,
    });
    await touchProject(ctx, args.projectId);
    return { docId, updatedAt: now };
  },
});

export const remove = mutation({
  args: { sessionToken: v.string(), projectId: v.id("projects"), docId: v.id("wikiPages") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.projectId, args.sessionToken);
    const page = await projectPage(ctx, args.projectId, args.docId);
    if (!page) throw new Error("Document not found");
    await ctx.db.delete(page._id);
    await touchProject(ctx, args.projectId);
    return null;
  },
});
