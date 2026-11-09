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

/** Where a project's work is supplied; only "onsite" is calculated automatically for tax. */
export const SUPPLY_TYPES = ["onsite", "offsite", "mixed", "multi_province"] as const;
export const SUPPLY_TYPE_LABEL: Record<(typeof SUPPLY_TYPES)[number], string> = {
  onsite: "Onsite at the event venue",
  offsite: "Offsite (e.g. prep or remote work)",
  mixed: "Mixed onsite and offsite",
  multi_province: "Covers events in more than one province",
};
