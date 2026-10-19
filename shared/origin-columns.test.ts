import { describe, expect, it } from "vitest";
import { compareWorkflowColumns, DEFAULT_WORKFLOW_COLUMNS, isDraftColumn, isLegacyIdeaColumn } from "./origin-columns.ts";

describe("draft column", () => {
  it("follows the flag when the backend sets it, and the title Draft otherwise", () => {
    expect(isDraftColumn({ title: "Draft" })).toBe(true);
    expect(isDraftColumn({ title: " draft " })).toBe(true);
    expect(isDraftColumn({ title: "Ideas", isDraft: true })).toBe(true);
    expect(isDraftColumn({ title: "Draft", isDraft: false })).toBe(false);
    expect(isDraftColumn({ title: "Todo" })).toBe(false);
  });

  it("recognises the Idea column of older boards only while it has no draft flag", () => {
    expect(isLegacyIdeaColumn({ title: "Idea" })).toBe(true);
    expect(isLegacyIdeaColumn({ title: "Idea", isDraft: true })).toBe(false);
    expect(isLegacyIdeaColumn({ title: "Todo" })).toBe(false);
  });

  it("puts semantic Drafts before active columns while retaining order within each group", () => {
    const columns = [
      { title: "Todo", order: -2 },
      { title: "Private ideas", isDraft: true, order: 99 },
      { title: "Draft", isDraft: false, order: -1 },
      { title: "Draft", order: 3 },
    ];
    expect(columns.toSorted(compareWorkflowColumns).map(column => column.title)).toEqual(["Draft", "Private ideas", "Todo", "Draft"]);
    expect(DEFAULT_WORKFLOW_COLUMNS).toEqual(["Draft", "Todo", "In progress"]);
  });
});
