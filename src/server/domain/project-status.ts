// Client-safe: no database imports.
export const PROJECT_STATUSES = ["draft", "staffing", "confirmed", "live", "completed", "reconciliation", "closed", "cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Forward progression plus one step back for corrections; cancellation until work is complete. */
export const PROJECT_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  draft: ["staffing", "cancelled"],
  staffing: ["draft", "confirmed", "cancelled"],
  confirmed: ["staffing", "live", "cancelled"],
  live: ["confirmed", "completed"],
  completed: ["live", "reconciliation"],
  reconciliation: ["completed", "closed"],
  closed: ["reconciliation"],
  cancelled: ["draft"],
};

export function canTransitionProject(from: ProjectStatus, to: ProjectStatus) {
  return PROJECT_TRANSITIONS[from].includes(to);
}
