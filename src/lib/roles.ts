export const FIELD_ROLES = ["BA", "TL", "PA", "AM", "CH", "MS", "DN"] as const;
export type FieldRole = (typeof FIELD_ROLES)[number];

export const FIELD_ROLE_NAMES: Record<FieldRole, string> = {
  BA: "Brand Ambassador",
  TL: "Team Lead",
  PA: "Production Assistant",
  AM: "Activation Manager",
  CH: "Chef",
  MS: "Mascot",
  DN: "Dancer",
};

export const FIELD_ROLE_DESCRIPTIONS: Record<FieldRole, string> = {
  BA: "Guest engagement, sampling, product education and demos",
  TL: "Supervises BAs, attendance and hours on site",
  PA: "Setup, logistics, inventory, installs and teardown",
  AM: "Runs on-site execution, staffing and reporting",
  CH: "Food preparation, cooking demos and tastings",
  MS: "Costumed character appearances and photo moments",
  DN: "Choreographed performances and crowd engagement",
};
