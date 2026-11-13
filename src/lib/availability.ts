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

// ─── Simple weekly picker: parts of the day ──────────────────────────────────────

export const DAY_PARTS = ["morning", "afternoon", "evening", "overnight"] as const;
export type DayPart = (typeof DAY_PARTS)[number];
/** What a contractor picks for one weekday. "open" means any time. */
export type DayChoice = { open: boolean; parts: DayPart[] };

export const DAY_PART_LABEL: Record<DayPart, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", overnight: "Overnight" };
export const DAY_PART_HINT: Record<DayPart, string> = { morning: "6am–12pm", afternoon: "12–5pm", evening: "5–10pm", overnight: "10pm onward" };

// Stored as plain windows on the weekday; overnight is recorded on the night it starts.
const PART_WINDOW: Record<DayPart, [string, string]> = {
  morning: ["06:00", "12:00"],
  afternoon: ["12:00", "17:00"],
  evening: ["17:00", "22:00"],
  overnight: ["22:00", "23:59"],
};
const OPEN_WINDOW: [string, string] = ["00:00", "23:59"];

/** Turns each weekday's choice into stored windows, merging parts that touch (morning + afternoon = 6am–5pm). */
export function choicesToRules(choices: Record<number, DayChoice>): AvailabilityRule[] {
  const out: AvailabilityRule[] = [];
  for (const [day, c] of Object.entries(choices)) {
    const weekday = Number(day);
    if (c.open) {
      out.push({ weekday, startTime: OPEN_WINDOW[0], endTime: OPEN_WINDOW[1] });
      continue;
    }
    const windows = DAY_PARTS.filter((p) => c.parts.includes(p)).map((p) => [...PART_WINDOW[p]] as [string, string]);
    for (const w of windows) {
      const last = out.at(-1);
      if (last && last.weekday === weekday && last.endTime === w[0]) last.endTime = w[1];
      else out.push({ weekday, startTime: w[0], endTime: w[1] });
    }
  }
  return out.sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
}

/** Reads stored windows back as choices. Older custom times light up every part they overlap. */
export function rulesToChoices(rules: AvailabilityRule[]): Record<number, DayChoice> {
  const out: Record<number, DayChoice> = {};
  for (let d = 0; d < 7; d++) out[d] = { open: false, parts: [] };
  for (const r of rules) {
    const c = out[r.weekday]!;
    if (r.startTime.slice(0, 5) === OPEN_WINDOW[0] && r.endTime.slice(0, 5) >= "23:59") {
      c.open = true;
      continue;
    }
    for (const p of DAY_PARTS) {
      const [s, e] = PART_WINDOW[p];
      if (r.startTime.slice(0, 5) < e && r.endTime.slice(0, 5) > s && !c.parts.includes(p)) c.parts.push(p);
    }
  }
  for (const c of Object.values(out)) {
    c.parts = DAY_PARTS.filter((p) => c.parts.includes(p));
    if (c.parts.length === DAY_PARTS.length) c.open = true;
    if (c.open) c.parts = [];
  }
  return out;
}
