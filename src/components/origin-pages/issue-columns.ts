import { compareWorkflowColumns, isDraftColumn } from "../../../shared/origin-columns";
import type { CloudColumn } from "./cloud-types";

export function openIssueColumns(columns: readonly CloudColumn[]): CloudColumn[] {
  return columns.filter((column) => !(column.isDone ?? column.title.trim().toLowerCase() === "done"))
    .sort(compareWorkflowColumns);
}

export function newIssueColumn(columns: readonly CloudColumn[], selectedId: string): CloudColumn | undefined {
  return columns.find((column) => column._id === selectedId) ?? columns.find(isDraftColumn);
}
