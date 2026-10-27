import { describe, expect, it } from "vitest";
import {
  assertDifferentApprover,
  assertNotOwnTimesheet,
  canAny,
  canOnProject,
  INTERNAL_ROLES,
  PERMISSIONS,
  resolveGrant,
  SeparationOfDutiesError,
  type Permission,
} from "@/server/authz/permissions";

const project = { ownerId: "pm-1", coordinatorId: "coord-1", memberIds: ["member-1"] };

describe("permission matrix", () => {
  it("gives administrators every permission across all projects", () => {
    for (const p of Object.keys(PERMISSIONS) as Permission[]) {
      expect(resolveGrant(["admin"], p)).toBe("all");
    }
  });

  it("denies everything to a user with no internal role", () => {
    for (const p of Object.keys(PERMISSIONS) as Permission[]) {
      expect(canAny({ userId: "x", roles: [] }, p)).toBe(false);
    }
  });

  it.each([
    ["finance", "payments.manage", true],
    ["finance", "booking.offer", false],
    ["finance", "users.manage", false],
    ["staffing_coordinator", "payments.view", false],
    ["staffing_coordinator", "payments.manage", false],
    ["staffing_coordinator", "rates.edit", false],
    ["staffing_coordinator", "timesheet.approve", false],
    ["project_manager", "payments.manage", false],
    ["project_manager", "rates.edit", false],
    ["project_manager", "users.manage", false],
  ] as const)("%s → %s = %s", (role, permission, expected) => {
    expect(canAny({ userId: "u", roles: [role] }, permission)).toBe(expected);
  });

  it("limits project managers to projects they are assigned to", () => {
    const pm = { userId: "pm-1", roles: ["project_manager"] as const };
    const otherPm = { userId: "pm-2", roles: ["project_manager"] as const };
    const member = { userId: "member-1", roles: ["project_manager"] as const };
    expect(canOnProject(pm, "timesheet.approve", project)).toBe(true);
    expect(canOnProject(member, "timesheet.approve", project)).toBe(true);
    expect(canOnProject(otherPm, "timesheet.approve", project)).toBe(false);
    // Read-wide permissions are not scoped.
    expect(canOnProject(otherPm, "project.view", project)).toBe(true);
  });

  it("takes the strongest grant when a user holds several roles", () => {
    expect(resolveGrant(["staffing_coordinator", "finance"], "timesheet.view")).toBe("all");
    expect(resolveGrant(["staffing_coordinator", "project_manager"], "booking.override_conflict")).toBe("assigned");
    const both = { userId: "coord-9", roles: ["staffing_coordinator", "finance"] as const };
    expect(canAny(both, "payments.manage")).toBe(true);
    expect(canAny(both, "booking.offer")).toBe(true);
  });

  it("only lets admin and finance correct hours after approval", () => {
    const allowed = INTERNAL_ROLES.filter((r) => canAny({ userId: "u", roles: [r] }, "timesheet.correct_after_approval"));
    expect(allowed.sort()).toEqual(["admin", "finance"]);
  });
});

describe("separation of duties", () => {
  it("blocks approving your own hours (rules 7 & 8)", () => {
    expect(() => assertNotOwnTimesheet("user-1", "user-1")).toThrow(SeparationOfDutiesError);
    expect(() => assertNotOwnTimesheet("user-1", "user-2")).not.toThrow();
    expect(() => assertNotOwnTimesheet("user-1", null)).not.toThrow();
  });

  it("requires a second person to approve a payment batch", () => {
    expect(() => assertDifferentApprover("fin-1", "fin-1")).toThrow(SeparationOfDutiesError);
    expect(() => assertDifferentApprover("fin-1", "fin-2")).not.toThrow();
  });
});
