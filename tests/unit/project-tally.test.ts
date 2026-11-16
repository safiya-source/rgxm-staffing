import { describe, expect, it } from "vitest";
import { tallyByProject, tallySheetRows } from "@/server/domain/project-tally";

const line = (projectCode: string, staffName: string, subtotalCents: number, taxCents = 0) => ({ projectCode, projectName: `Project ${projectCode}`, staffName, subtotalCents, taxCents, totalCents: subtotalCents + taxCents });

describe("tallyByProject", () => {
  it("totals each contractor per project, with project subtotals and a batch total", () => {
    const t = tallyByProject([line("B", "Zoe", 10000), line("A", "Ali", 20000, 2600), line("A", "Ali", 5000, 650), line("A", "Bea", 12000), line("B", "Ali", 3000)]);
    expect(t.projects.map((p) => p.projectCode)).toEqual(["A", "B"]);
    expect(t.projects[0]!.people).toEqual([
      { staffName: "Ali", lines: 2, subtotalCents: 25000, taxCents: 3250, totalCents: 28250 },
      { staffName: "Bea", lines: 1, subtotalCents: 12000, taxCents: 0, totalCents: 12000 },
    ]);
    expect(t.projects[0]!.totalCents).toBe(40250);
    // The same person on two projects is tallied separately on each.
    expect(t.projects[1]!.people.map((w) => [w.staffName, w.totalCents])).toEqual([["Ali", 3000], ["Zoe", 10000]]);
    expect(t.totalCents).toBe(53250);
    expect(t.taxCents).toBe(3250);
  });

  it("lays out spreadsheet rows with subtotals and a batch total", () => {
    const rows = tallySheetRows(tallyByProject([line("A", "Ali", 20000, 2600)]), (c) => c / 100);
    expect(rows[0]).toEqual(["Project", "Contractor", "Lines", "Before tax", "Tax", "Total"]);
    expect(rows[1]).toEqual(["A · Project A", "Ali", 1, 200, 26, 226]);
    expect(rows[2]).toEqual(["A subtotal", "", 1, 200, 26, 226]);
    expect(rows.at(-1)).toEqual(["Batch total", "", "", 200, 26, 226]);
  });
});
