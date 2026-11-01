import { describe, expect, it } from "vitest";
import { displayName, formatDate, formatDateTime, formatDue, formatRelative, formatTime, parseDueDate, toDueDate } from "./format";

const now = new Date(2026, 10, 3, 16, 19, 30);

describe("formatDate", () => {
  it("omits the year only in the current year", () => {
    expect(formatDate(new Date(2026, 10, 3), now)).toBe("Nov 3");
    expect(formatDate(new Date(2026, 0, 21).getTime(), now)).toBe("Jan 21");
    expect(formatDate(new Date(2025, 10, 3), now)).toBe("Nov 3, 2025");
  });
});

describe("formatTime", () => {
  it("uses a 12-hour clock without a leading zero", () => {
    expect(formatTime(now)).toBe("4:19 PM");
    expect(formatTime(new Date(2026, 10, 3, 9, 5))).toBe("9:05 AM");
    expect(formatTime(new Date(2026, 10, 3, 0, 0))).toBe("12:00 AM");
  });
});

describe("formatDateTime", () => {
  it("joins date and time", () => {
    expect(formatDateTime(now, now)).toBe("Nov 3, 4:19 PM");
    expect(formatDateTime(new Date(2025, 1, 9, 13, 0), now)).toBe("Feb 9, 2025, 1:00 PM");
  });
});

describe("formatRelative", () => {
  it("steps from now to minutes, hours, yesterday and the date", () => {
    expect(formatRelative(now.getTime() - 20_000, now)).toBe("now");
    expect(formatRelative(now.getTime() + 60_000, now)).toBe("now");
    expect(formatRelative(now.getTime() - 5 * 60_000, now)).toBe("5m");
    expect(formatRelative(now.getTime() - 59 * 60_000, now)).toBe("59m");
    expect(formatRelative(now.getTime() - 3 * 3_600_000, now)).toBe("3h");
    expect(formatRelative(new Date(2026, 10, 2, 9, 0), now)).toBe("Yesterday");
    expect(formatRelative(new Date(2026, 10, 1, 9, 0), now)).toBe("Nov 1");
    expect(formatRelative(new Date(2025, 11, 30, 9, 0), now)).toBe("Dec 30, 2025");
  });
});

describe("due dates", () => {
  it("parses and prints local dates without shifting the day", () => {
    const date = parseDueDate("2026-03-29");
    expect(date && [date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 2, 29, 0]);
    expect(toDueDate(date!)).toBe("2026-03-29");
    expect(toDueDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("rejects malformed and impossible dates", () => {
    expect(parseDueDate("")).toBeNull();
    expect(parseDueDate(undefined)).toBeNull();
    expect(parseDueDate("2026-2-3")).toBeNull();
    expect(parseDueDate("2026-02-30")).toBeNull();
    expect(formatDue("soon", now)).toBeNull();
  });

  it("labels nearby days and sets a tone", () => {
    expect(formatDue("2026-11-03", now)).toEqual({ label: "Today", tone: "soon" });
    expect(formatDue("2026-11-04", now)).toEqual({ label: "Tomorrow", tone: "soon" });
    expect(formatDue("2026-11-02", now)).toEqual({ label: "Yesterday", tone: "overdue" });
    expect(formatDue("2026-10-20", now)).toEqual({ label: "Oct 20", tone: "overdue" });
    expect(formatDue("2026-11-12", now)).toEqual({ label: "Nov 12", tone: "later" });
    expect(formatDue("2027-01-08", now)).toEqual({ label: "Jan 8, 2027", tone: "later" });
  });
});

describe("displayName", () => {
  it("falls back from name to username to email", () => {
    expect(displayName({ name: "Ada Lovelace", username: "ada", email: "ada@example.com" })).toBe("Ada Lovelace");
    expect(displayName({ name: "  ", username: "ada", email: "ada@example.com" })).toBe("ada");
    expect(displayName({ email: "grace.hopper@example.com" })).toBe("grace.hopper");
    expect(displayName({})).toBe("");
  });
});
