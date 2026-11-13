import { describe, expect, it } from "vitest";
import { demoDate, demoOffsetDays } from "@/lib/demo-dates";

describe("demo dates", () => {
  it("keeps the authored dates while they are still ahead", () => {
    expect(demoOffsetDays(new Date("2026-11-01T12:00:00Z"))).toBe(0);
    expect(demoDate("2026-11-12", new Date("2026-11-01T12:00:00Z"))).toBe("2026-11-12");
  });

  it("moves every demo date forward together once they get close, using Toronto's date", () => {
    // 8pm in Toronto on Nov 12 is already Nov 13 in UTC; Toronto's date counts.
    const now = new Date("2026-11-13T01:00:00Z");
    expect(demoDate("2026-11-12", now)).toBe("2026-11-14");
    expect(demoDate("2026-12-04", now)).toBe("2026-12-06");
    expect(demoDate("2026-11-12", new Date("2027-02-27T15:00:00Z"))).toBe("2027-03-01");
  });
});
