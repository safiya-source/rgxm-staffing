import { describe, expect, it } from "vitest";
import { expandShiftPattern, localDayBounds, MAX_BULK_SHIFTS, shiftInstants, utcToZoned, zonedToUtc } from "@/lib/time";

const TO = "America/Toronto";

describe("zoned time conversion", () => {
  it("converts Toronto wall-clock time to UTC in winter and summer", () => {
    expect(zonedToUtc("2026-11-12", "10:00", TO).toISOString()).toBe("2026-11-12T15:00:00.000Z"); // EST, UTC-5
    expect(zonedToUtc("2026-07-01", "10:00", TO).toISOString()).toBe("2026-07-01T14:00:00.000Z"); // EDT, UTC-4
  });

  it("handles other zones", () => {
    // Regina has no DST changes, so this doesn't depend on the tzdata version (Vancouver's rules changed in tzdata 2026b).
    expect(zonedToUtc("2026-11-12", "10:00", "America/Regina").toISOString()).toBe("2026-11-12T16:00:00.000Z");
    expect(zonedToUtc("2026-11-12", "10:00", "America/St_Johns").toISOString()).toBe("2026-11-12T13:30:00.000Z");
  });

  it("moves a time inside the spring-forward gap forward by an hour", () => {
    // 2026-03-08 02:30 doesn't exist in Toronto; it becomes 03:30 EDT.
    expect(zonedToUtc("2026-03-08", "02:30", TO).toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("uses the first occurrence of an ambiguous fall-back time", () => {
    // 2026-11-01 01:30 happens twice; the first is EDT (UTC-4).
    expect(zonedToUtc("2026-11-01", "01:30", TO).toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("round-trips UTC to local date and time", () => {
    expect(utcToZoned(new Date("2026-11-13T03:00:00Z"), TO)).toMatchObject({ date: "2026-11-12", time: "22:00", weekday: 4 });
  });

  it("gives 23- and 25-hour days on DST changes", () => {
    const [s1, e1] = localDayBounds("2026-03-08", TO);
    expect((e1.getTime() - s1.getTime()) / 3_600_000).toBe(23);
    const [s2, e2] = localDayBounds("2026-11-01", TO);
    expect((e2.getTime() - s2.getTime()) / 3_600_000).toBe(25);
  });
});

describe("shift instants", () => {
  it("rolls an end time at or before the start to the next day (overnight)", () => {
    const s = shiftInstants("2026-11-20", "21:00", "05:00", TO);
    expect(s.crossesMidnight).toBe(true);
    expect(s.startsAt.toISOString()).toBe("2026-11-21T02:00:00.000Z");
    expect(s.endsAt.toISOString()).toBe("2026-11-21T10:00:00.000Z");
    expect(s.minutes).toBe(480);
  });

  it("measures real elapsed time across a DST change", () => {
    // Overnight shift spanning fall-back: 22:00 Oct 31 → 06:00 Nov 1 is 9 real hours.
    expect(shiftInstants("2026-10-31", "22:00", "06:00", TO).minutes).toBe(540);
    // Spanning spring-forward: 22:00 Mar 7 → 06:00 Mar 8 is 7 real hours.
    expect(shiftInstants("2026-03-07", "22:00", "06:00", TO).minutes).toBe(420);
  });
});

describe("expandShiftPattern", () => {
  it("creates one shift per day in the range", () => {
    const w = expandShiftPattern({ startDate: "2026-11-12", endDate: "2026-11-15", weekdays: [], startTime: "10:00", endTime: "18:00", timeZone: TO });
    expect(w.map((x) => x.date)).toEqual(["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
    expect(w.every((x) => x.minutes === 480)).toBe(true);
  });

  it("filters by weekday", () => {
    // Nov 2026: 12 Thu, 13 Fri, 14 Sat, 15 Sun, ... 19 Thu
    const w = expandShiftPattern({ startDate: "2026-11-12", endDate: "2026-11-22", weekdays: [6, 0], startTime: "10:00", endTime: "18:00", timeZone: TO });
    expect(w.map((x) => x.date)).toEqual(["2026-11-14", "2026-11-15", "2026-11-21", "2026-11-22"]);
  });

  it("rejects invalid input", () => {
    const base = { weekdays: [], startTime: "10:00", endTime: "18:00", timeZone: TO };
    expect(() => expandShiftPattern({ ...base, startDate: "2026-11-15", endDate: "2026-11-12" })).toThrow(/before start/);
    expect(() => expandShiftPattern({ ...base, startDate: "2026-11-12", endDate: "2026-11-12", endTime: "10:00" })).toThrow(/same/);
    expect(() => expandShiftPattern({ ...base, startDate: "2026-02-30", endDate: "2026-03-01" })).toThrow();
  });

  it("caps very large bulk creations", () => {
    expect(() =>
      expandShiftPattern({ startDate: "2026-01-01", endDate: "2027-12-31", weekdays: [], startTime: "10:00", endTime: "18:00", timeZone: TO }),
    ).toThrow(new RegExp(String(MAX_BULK_SHIFTS)));
  });
});
