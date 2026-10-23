// Staff availability is a preference, not a booking (rule 5). These helpers turn recurring
// weekly windows + date exceptions into a simple status for a given local date.
import { parseISO } from "date-fns";

export type AvailabilityRule = { weekday: number; startTime: string; endTime: string };
export type AvailabilityException = { date: string; kind: "available" | "unavailable"; startTime: string | null; endTime: string | null };
export type AvailabilityStatus = "available" | "unavailable" | "unknown";

/** A date-specific exception beats the weekly pattern; no data at all is "unknown", never "unavailable". */
export function availabilityOnDate(
  rules: AvailabilityRule[],
  exceptions: AvailabilityException[],
  date: string,
): AvailabilityStatus {
  const todays = exceptions.filter((e) => e.date === date);
  if (todays.some((e) => e.kind === "unavailable" && !e.startTime)) return "unavailable";
  if (todays.some((e) => e.kind === "available")) return "available";
  const weekday = parseISO(date).getDay();
  if (rules.some((r) => r.weekday === weekday)) return "available";
  return "unknown";
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
