export const FIELD_ROLES = ["BA", "TL", "PA", "AM"] as const;
export type FieldRole = (typeof FIELD_ROLES)[number];

export const FIELD_ROLE_NAMES: Record<FieldRole, string> = {
  BA: "Brand Ambassador",
  TL: "Team Lead",
  PA: "Production Assistant",
  AM: "Activation Manager",
};

export const FIELD_ROLE_DESCRIPTIONS: Record<FieldRole, string> = {
  BA: "Guest engagement, sampling, product education and demos",
  TL: "Supervises BAs, attendance and hours on site",
  PA: "Setup, logistics, inventory, installs and teardown",
  AM: "Runs on-site execution, staffing and reporting",
};
