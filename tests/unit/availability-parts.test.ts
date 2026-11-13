import { describe, expect, it } from "vitest";
import { choicesToRules, rulesToChoices, type DayChoice } from "@/lib/availability";

const none: DayChoice = { open: false, parts: [] };

describe("weekly availability by part of day", () => {
  it("stores parts as windows, merging ones that touch, and open as the whole day", () => {
    const rules = choicesToRules({
      1: { open: false, parts: ["morning", "afternoon"] },
      2: { open: false, parts: ["morning", "evening"] },
      5: { open: false, parts: ["overnight"] },
      6: { open: true, parts: [] },
      0: none,
    });
    expect(rules).toEqual([
      { weekday: 1, startTime: "06:00", endTime: "17:00" },
      { weekday: 2, startTime: "06:00", endTime: "12:00" },
      { weekday: 2, startTime: "17:00", endTime: "22:00" },
      { weekday: 5, startTime: "22:00", endTime: "23:59" },
      { weekday: 6, startTime: "00:00", endTime: "23:59" },
    ]);
    // Every rule is a valid window (end after start), and a full week stays under the 21-window limit.
    const full = choicesToRules(Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { open: false, parts: ["morning", "evening"] }])) as Record<number, DayChoice>);
    expect(full.length).toBeLessThanOrEqual(21);
    expect(full.every((r) => r.endTime > r.startTime)).toBe(true);
  });

  it("reads them back, treating all four parts as open and mapping older custom times", () => {
    const back = rulesToChoices([
      { weekday: 1, startTime: "06:00:00", endTime: "17:00:00" },
      { weekday: 6, startTime: "00:00:00", endTime: "23:59:00" },
      { weekday: 3, startTime: "09:00", endTime: "21:00" }, // an older custom window
    ]);
    expect(back[1]).toEqual({ open: false, parts: ["morning", "afternoon"] });
    expect(back[6]).toEqual({ open: true, parts: [] });
    expect(back[3]).toEqual({ open: false, parts: ["morning", "afternoon", "evening"] });
    expect(back[0]).toEqual(none);
    expect(rulesToChoices(choicesToRules({ 4: { open: false, parts: ["morning", "afternoon", "evening", "overnight"] } }))[4]).toEqual({ open: true, parts: [] });
  });
});
