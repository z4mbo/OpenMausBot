import { defineTable } from "convex/server";
import { v } from "convex/values";

export const pulseTables = {
  /** Per project and UTC day (`YYYY-MM-DD`), counts no other table keeps by time. */
  pulseDays: defineTable({
    projectId: v.id("projects"),
    day: v.string(),
    pageViews: v.number(),
  }).index("by_projectId_and_day", ["projectId", "day"]),
};
