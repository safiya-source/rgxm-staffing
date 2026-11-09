export const CATEGORY_LABEL: Record<string, string> = {
  unauthorized_access: "Unauthorised access",
  lost_or_stolen_device: "Lost or stolen device",
  misdirected_email: "Email or file sent to the wrong person",
  vendor_incident: "Incident at a service provider",
  system_vulnerability: "System vulnerability",
  other: "Other",
};

export const RISK_LABEL: Record<string, string> = {
  undetermined: "Not assessed yet",
  real_risk_of_significant_harm: "Real risk of significant harm",
  no_real_risk: "No real risk of significant harm",
};

export const STATUS_LABEL: Record<string, string> = { open: "Open", contained: "Contained", closed: "Closed" };
