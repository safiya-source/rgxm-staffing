import { describe, expect, it } from "vitest";
import { assertTransition, BookingTransitionError, canTransition, overlaps, resolveRate } from "@/server/domain/booking-rules";

describe("booking transitions", () => {
  it("never lets staff confirm themselves (rules 5 & 6)", () => {
    expect(canTransition("interested", "confirmed", "staff")).toBe(false);
    expect(canTransition("offered", "confirmed", "staff")).toBe(false);
    expect(canTransition("interested", "confirmed", "rgxm")).toBe(true);
  });

  it("requires a response before confirmation", () => {
    expect(canTransition("offered", "confirmed", "rgxm")).toBe(false);
  });

  it("lets staff respond to offers and back out before or after confirmation", () => {
    expect(canTransition("offered", "interested", "staff")).toBe(true);
    expect(canTransition("offered", "declined", "staff")).toBe(true);
    expect(canTransition("interested", "declined", "staff")).toBe(true);
    expect(canTransition("confirmed", "cancelled", "staff")).toBe(true);
    expect(canTransition("confirmed", "declined", "staff")).toBe(false);
  });

  it("supports shortlist and waitlist moves by RGXM", () => {
    expect(canTransition("interested", "awaiting_confirmation", "rgxm")).toBe(true);
    expect(canTransition("awaiting_confirmation", "waitlisted", "rgxm")).toBe(true);
    expect(canTransition("waitlisted", "confirmed", "rgxm")).toBe(true);
    expect(canTransition("waitlisted", "confirmed", "staff")).toBe(false);
  });

  it("treats declined, cancelled and completed as final", () => {
    for (const to of ["offered", "interested", "confirmed"] as const) {
      expect(canTransition("declined", to, "rgxm")).toBe(false);
      expect(canTransition("cancelled", to, "rgxm")).toBe(false);
      expect(canTransition("completed", to, "rgxm")).toBe(false);
    }
  });

  it("throws a readable error", () => {
    expect(() => assertTransition("declined", "confirmed", "rgxm")).toThrow(BookingTransitionError);
    expect(() => assertTransition("declined", "confirmed", "rgxm")).toThrow(/declined to confirmed/);
  });
});

describe("rate resolution (rule 3)", () => {
  const none = { projectStaffRate: null, shiftRate: null, projectRoleRate: null, staffDefaultRate: null };
  it("follows the documented precedence", () => {
    expect(resolveRate({ projectStaffRate: 3200, shiftRate: 2500, projectRoleRate: 2700, staffDefaultRate: 2600 })).toEqual({ rateCents: 3200, source: "project_staff" });
    expect(resolveRate({ ...none, shiftRate: 2500, projectRoleRate: 2700, staffDefaultRate: 2600 })).toEqual({ rateCents: 2500, source: "shift" });
    expect(resolveRate({ ...none, projectRoleRate: 2700, staffDefaultRate: 2600 })).toEqual({ rateCents: 2700, source: "project_role" });
    expect(resolveRate({ ...none, staffDefaultRate: 2600 })).toEqual({ rateCents: 2600, source: "default" });
  });
  it("returns null when no rate is known", () => {
    expect(resolveRate(none)).toBeNull();
  });
  it("treats zero as a real rate, not a missing one", () => {
    expect(resolveRate({ ...none, shiftRate: 0, staffDefaultRate: 2600 })).toEqual({ rateCents: 0, source: "shift" });
  });
});

describe("overlaps", () => {
  const t = (s: string) => new Date(`2026-11-12T${s}:00Z`);
  it("treats touching shifts as not overlapping", () => {
    expect(overlaps({ startsAt: t("10:00"), endsAt: t("14:00") }, { startsAt: t("14:00"), endsAt: t("18:00") })).toBe(false);
    expect(overlaps({ startsAt: t("10:00"), endsAt: t("14:01") }, { startsAt: t("14:00"), endsAt: t("18:00") })).toBe(true);
  });
});
