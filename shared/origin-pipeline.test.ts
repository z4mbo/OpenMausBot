import { describe, expect, it } from "vitest";
import { captureFormSnippet, normalizeLeadEmail, normalizeLeadPhone, parseLeadsCsv, stageTotals } from "./origin-pipeline.ts";

describe("pipeline lead fields", () => {
  it("normalises emails and phone numbers or rejects them", () => {
    expect(normalizeLeadEmail(" Ada@Example.COM ")).toBe("ada@example.com");
    expect(normalizeLeadEmail("not an email")).toBeUndefined();
    expect(normalizeLeadPhone("+39 (333) 123-4567")).toBe("+393331234567");
    expect(normalizeLeadPhone("0044 20 7946 0958")).toBe("+442079460958");
    expect(normalizeLeadPhone("call me")).toBeUndefined();
  });

  it("totals leads per stage", () => {
    const totals = stageTotals([{ stage: "New", value: 100 }, { stage: "New" }, { stage: "Won", value: 50 }, { stage: "Gone", value: 9 }], ["New", "Won"]);
    expect(Object.fromEntries(totals)).toEqual({ New: { count: 2, value: 100 }, Won: { count: 1, value: 50 } });
  });
});

describe("CSV import", () => {
  it("maps common headers, quoted cells and first/last names", () => {
    const csv = "﻿First Name,Last Name,E-mail,Phone Number,Company,Deal Value,Tags,Notes\r\n"
      + "Ada,Lovelace,ADA@example.com,+39 333 1234567,\"Engines, Ltd\",\"1,200\",warm;saas,\"Met at \"\"PyCon\"\"\"\r\n"
      + ",,,,,,,\r\n"
      + "Bob,,,,,,,\n";
    const { rows, skipped } = parseLeadsCsv(csv);
    expect(skipped).toBe(0);
    expect(rows).toEqual([
      { name: "Ada Lovelace", company: "Engines, Ltd", email: "ada@example.com", phone: "+393331234567", value: 1200, tags: ["warm", "saas"], notes: "Met at \"PyCon\"" },
      { name: "Bob" },
    ]);
  });

  it("reads semicolon exports and skips rows with nothing to reach", () => {
    const { rows, skipped } = parseLeadsCsv("nome;email;stage\nCarla;carla@example.com;Qualified\n;;\n");
    expect(rows).toEqual([{ name: "Carla", email: "carla@example.com", stage: "Qualified" }]);
    expect(skipped).toBe(0);
    expect(parseLeadsCsv("email\nnot-an-email\n")).toEqual({ rows: [], skipped: 1 });
  });

  it("escapes the capture address in the form snippet", () => {
    expect(captureFormSnippet("https://x.convex.site/pipeline/capture?token=a&b=\"c\"")).toContain('action="https://x.convex.site/pipeline/capture?token=a&#38;b=&#34;c&#34;"');
  });
});
