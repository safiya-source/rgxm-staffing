import { describe, expect, it } from "vitest";
import { formatDateRange, formatInZone, formatMinutes, formatMoney } from "@/lib/format";

describe("formatting", () => {
  it("formats integer cents as CAD", () => {
    expect(formatMoney(250000)).toBe("$2,500.00");
    expect(formatMoney(1)).toBe("$0.01");
  });

  it("renders instants in the location's time zone, across the DST change", () => {
    // 2026-11-01 is the fall-back date in Toronto (EDT → EST).
    expect(formatInZone("2026-10-31T14:00:00Z", "America/Toronto", "yyyy-MM-dd HH:mm")).toBe("2026-10-31 10:00");
    expect(formatInZone("2026-11-12T14:00:00Z", "America/Toronto", "yyyy-MM-dd HH:mm")).toBe("2026-11-12 09:00");
    expect(formatInZone("2026-11-12T14:00:00Z", "America/Vancouver", "yyyy-MM-dd HH:mm")).toBe("2026-11-12 06:00");
  });

  it("formats durations and ranges", () => {
    expect(formatMinutes(510)).toBe("8h 30m");
    expect(formatMinutes(480)).toBe("8h");
    expect(formatDateRange("2026-11-12", "2026-11-15")).toBe("Nov 12–15, 2026");
    expect(formatDateRange("2026-11-30", "2026-12-02")).toBe("Nov 30 – Dec 2, 2026");
  });
});
