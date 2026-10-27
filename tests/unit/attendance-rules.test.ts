import { describe, expect, it } from "vitest";
import { canMoveTimesheet, checkInWindow, deriveFlags, distanceMeters, staffCanEdit, supervises, workedMinutes } from "@/server/domain/attendance-rules";

const t = (hhmm: string, day = 12) => new Date(`2026-11-${day}T${hhmm}:00Z`);

describe("check-in window", () => {
  it("opens before the start and closes at the scheduled end", () => {
    const w = checkInWindow({ startsAt: t("15:00"), endsAt: t("23:00") }, 60);
    expect(w.opensAt.toISOString()).toBe("2026-11-12T14:00:00.000Z");
    expect(w.closesAt.toISOString()).toBe("2026-11-12T23:00:00.000Z");
  });
});

describe("worked minutes", () => {
  it("subtracts recorded breaks only", () => {
    expect(workedMinutes(t("15:00"), t("23:00"), 0)).toBe(480);
    expect(workedMinutes(t("15:00"), t("23:00"), 30)).toBe(450);
  });
  it("ignores partial minutes and never goes negative", () => {
    expect(workedMinutes(new Date("2026-11-12T15:00:00Z"), new Date("2026-11-12T15:10:59Z"), 0)).toBe(10);
    expect(workedMinutes(t("15:00"), t("15:10"), 30)).toBe(0);
  });
  it("handles overnight shifts", () => {
    expect(workedMinutes(t("22:00", 12), t("06:00", 13), 0)).toBe(480);
  });
  it("applies quarter-hour rounding only when configured", () => {
    expect(workedMinutes(t("15:00"), new Date("2026-11-12T22:52:00Z"), 0, "quarter_hour")).toBe(465);
    expect(workedMinutes(t("15:00"), new Date("2026-11-12T22:53:00Z"), 0, "quarter_hour")).toBe(480);
  });
});

describe("distance", () => {
  it("measures metres between coordinates", () => {
    const eaton = { lat: 43.6544, lng: -79.3807 };
    expect(distanceMeters(eaton, eaton)).toBe(0);
    const unionStation = { lat: 43.6453, lng: -79.3806 };
    expect(distanceMeters(eaton, unionStation)).toBeGreaterThan(950);
    expect(distanceMeters(eaton, unionStation)).toBeLessThan(1070);
  });
});

describe("flags", () => {
  const base = {
    scheduledStart: t("15:00"),
    scheduledEnd: t("23:00"),
    checkIn: t("15:00"),
    checkOut: t("23:00"),
    shiftEnded: true,
    anyOffline: false,
    anyOutsideGeofence: false,
    anySupervisorRecorded: false,
    corrected: false,
  };
  it("is empty for an on-time shift", () => expect(deriveFlags(base)).toEqual([]));
  it("allows a 5-minute grace period before 'late'", () => {
    expect(deriveFlags({ ...base, checkIn: t("15:05") })).toEqual([]);
    expect(deriveFlags({ ...base, checkIn: t("15:06") })).toContain("late");
  });
  it("flags missing records only after the shift has ended", () => {
    expect(deriveFlags({ ...base, checkIn: null, checkOut: null, shiftEnded: false })).toEqual([]);
    expect(deriveFlags({ ...base, checkIn: null, checkOut: null })).toContain("missing_check_in");
    expect(deriveFlags({ ...base, checkOut: null })).toContain("missing_check_out");
  });
  it("flags early departures, offline entries and very long shifts", () => {
    expect(deriveFlags({ ...base, checkOut: t("22:30") })).toContain("left_early");
    expect(deriveFlags({ ...base, anyOffline: true })).toContain("offline_entry");
    expect(deriveFlags({ ...base, checkOut: t("08:00", 13) })).toContain("long_shift");
  });
});

describe("timesheet workflow", () => {
  it("lets staff submit but never approve (rule 7)", () => {
    expect(canMoveTimesheet("in_progress", "submitted", "staff")).toBe(true);
    expect(canMoveTimesheet("submitted", "approved", "staff")).toBe(false);
    expect(canMoveTimesheet("supervisor_verified", "approved", "supervisor")).toBe(false);
  });
  it("lets supervisors verify but not approve (rule 8)", () => {
    expect(canMoveTimesheet("submitted", "supervisor_verified", "supervisor")).toBe(true);
    expect(canMoveTimesheet("submitted", "approved", "supervisor")).toBe(false);
  });
  it("lets RGXM approve and send back, and nothing reopens approved hours by status", () => {
    expect(canMoveTimesheet("supervisor_verified", "approved", "rgxm")).toBe(true);
    expect(canMoveTimesheet("submitted", "needs_review", "rgxm")).toBe(true);
    expect(canMoveTimesheet("approved", "submitted", "rgxm")).toBe(false);
    expect(canMoveTimesheet("approved", "needs_review", "rgxm")).toBe(false);
  });
  it("only allows staff edits before approval", () => {
    expect(staffCanEdit("in_progress")).toBe(true);
    expect(staffCanEdit("needs_review")).toBe(true);
    expect(staffCanEdit("submitted")).toBe(false);
    expect(staffCanEdit("approved")).toBe(false);
  });
});

describe("supervision", () => {
  it("follows the on-site hierarchy", () => {
    expect(supervises("TL", "BA")).toBe(true);
    expect(supervises("TL", "PA")).toBe(true);
    expect(supervises("TL", "TL")).toBe(false);
    expect(supervises("AM", "TL")).toBe(true);
    expect(supervises("AM", "AM")).toBe(false);
    expect(supervises("BA", "BA")).toBe(false);
  });
});
