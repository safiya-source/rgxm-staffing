import type { FieldRole } from "@/lib/roles";

export type LocationOption = { id: string; name: string; timezone: string };
export type RequirementOption = {
  id: string;
  role: FieldRole;
  quantity: number;
  locationId: string | null;
  defaultRateCents: number | null;
  startDate: string | null;
  endDate: string | null;
};
export type TemplateOption = {
  id: string;
  name: string;
  role: FieldRole;
  localStartTime: string;
  localEndTime: string;
  headcount: number;
  rateCents: number | null;
  uniform: string | null;
  instructions: string | null;
};
export type BreakPolicyOption = { id: string; name: string };
export type ShiftItem = {
  id: string;
  projectId: string;
  locationId: string;
  locationName: string;
  requirementId: string | null;
  role: FieldRole;
  startsAt: string;
  endsAt: string;
  timezone: string;
  headcount: number;
  rateCents: number | null;
  status: string;
  uniform: string | null;
  instructions: string | null;
  reportingLocation: string | null;
  onsiteContact: string | null;
  breakPolicyId: string | null;
  cancelReason: string | null;
  confirmed: number;
  pending: number;
};
