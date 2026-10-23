// Internal permission matrix (see docs/PLAN.md §2). Pure and side-effect free so it can be
// unit-tested exhaustively; request-time enforcement lives in ./guard.ts.
//
// Grants:
//  "all"      — across every project
//  "assigned" — only projects where the user is owner, coordinator or a listed member

export const INTERNAL_ROLES = ["admin", "project_manager", "staffing_coordinator", "finance"] as const;
export type InternalRole = (typeof INTERNAL_ROLES)[number];

export const ROLE_LABELS: Record<InternalRole, string> = {
  admin: "System Administrator",
  project_manager: "Project Manager",
  staffing_coordinator: "Staffing Coordinator",
  finance: "Finance",
};

export type Grant = "all" | "assigned";

const A = "all" as const;
const S = "assigned" as const;

export const PERMISSIONS = {
  "users.manage": { admin: A },
  "settings.manage": { admin: A },
  "settings.view": { admin: A, finance: A },
  "audit.view": { admin: A, project_manager: S, finance: A },
  "mail_log.view": { admin: A },

  "project.view": { admin: A, project_manager: A, staffing_coordinator: A, finance: A },
  "project.create": { admin: A, project_manager: A },
  "project.edit": { admin: A, project_manager: S },
  "shift.manage": { admin: A, project_manager: S, staffing_coordinator: S },
  "comms.manage": { admin: A, project_manager: S, staffing_coordinator: S },

  "talent.view": { admin: A, project_manager: A, staffing_coordinator: A, finance: A },
  "talent.edit": { admin: A, project_manager: A, staffing_coordinator: A },
  "talent.import": { admin: A, staffing_coordinator: A },
  "talent.export": { admin: A, staffing_coordinator: A },
  "talent.notes.view": { admin: A, project_manager: A, staffing_coordinator: A },
  "talent.emergency.view": { admin: A, project_manager: S, staffing_coordinator: A },
  "talent.evaluations.view": { admin: A, project_manager: A, staffing_coordinator: A },

  "rates.view": { admin: A, project_manager: A, staffing_coordinator: A, finance: A },
  "rates.edit": { admin: A, finance: A },
  "rates.project_override": { admin: A, project_manager: S },

  "booking.offer": { admin: A, project_manager: S, staffing_coordinator: S },
  "booking.confirm": { admin: A, project_manager: S, staffing_coordinator: S },
  "booking.override_conflict": { admin: A, project_manager: S },

  "timesheet.view": { admin: A, project_manager: S, staffing_coordinator: S, finance: A },
  "timesheet.prepare": { admin: A, project_manager: S, staffing_coordinator: S },
  "timesheet.approve": { admin: A, project_manager: S },
  "timesheet.correct_after_approval": { admin: A, finance: A },

  "budget.view": { admin: A, project_manager: S, finance: A },
  "payments.view": { admin: A, project_manager: S, finance: A },
  "payments.manage": { admin: A, finance: A },

  "reports.view": { admin: A, project_manager: A, staffing_coordinator: A, finance: A },
} as const satisfies Record<string, Partial<Record<InternalRole, Grant>>>;

export type Permission = keyof typeof PERMISSIONS;

/** Strongest grant any of the user's roles gives for a permission, or null. */
export function resolveGrant(roles: readonly InternalRole[], permission: Permission): Grant | null {
  const rule: Partial<Record<InternalRole, Grant>> = PERMISSIONS[permission];
  let best: Grant | null = null;
  for (const role of roles) {
    const grant = rule[role];
    if (grant === "all") return "all";
    if (grant === "assigned") best = "assigned";
  }
  return best;
}

export type ProjectScope = {
  ownerId: string | null;
  coordinatorId: string | null;
  memberIds: readonly string[];
};

export function isAssigned(userId: string, project: ProjectScope): boolean {
  return project.ownerId === userId || project.coordinatorId === userId || project.memberIds.includes(userId);
}

export type Actor = { userId: string; roles: readonly InternalRole[] };

/** Global check: does the actor hold this permission anywhere? */
export function canAny(actor: Actor, permission: Permission): boolean {
  return resolveGrant(actor.roles, permission) !== null;
}

/** Project-scoped check. */
export function canOnProject(actor: Actor, permission: Permission, project: ProjectScope): boolean {
  const grant = resolveGrant(actor.roles, permission);
  if (grant === "all") return true;
  if (grant === "assigned") return isAssigned(actor.userId, project);
  return false;
}

// ─── Separation of duties ─────────────────────────────────────────────────────────

export class SeparationOfDutiesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeparationOfDutiesError";
  }
}

/**
 * Business rules 7 & 8: nobody approves or verifies payable hours on their own timesheet.
 * `timesheetOwnerUserId` is the user account of the staff member whose hours are being approved.
 */
export function assertNotOwnTimesheet(actorUserId: string, timesheetOwnerUserId: string | null) {
  if (timesheetOwnerUserId && actorUserId === timesheetOwnerUserId) {
    throw new SeparationOfDutiesError("You can't verify or approve your own hours.");
  }
}

/** Payment batches need a second person to approve them. */
export function assertDifferentApprover(creatorUserId: string, approverUserId: string) {
  if (creatorUserId === approverUserId) {
    throw new SeparationOfDutiesError("A payment batch must be approved by someone other than its creator.");
  }
}
