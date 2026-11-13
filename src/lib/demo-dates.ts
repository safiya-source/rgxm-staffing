// Demo data was written for an activation on Nov 12–15, 2026. Once that date gets close, every demo
// date moves forward by the same number of days, so the demo (and the end-to-end tests that use it)
// always has upcoming shifts. Weekdays may change; nothing in the demo depends on them.
import { utcToZoned } from "./time";

const AUTHORED_FIRST_DAY = "2026-11-12";
const DAY_MS = 24 * 60 * 60 * 1000;
const LEAD_DAYS = 2; // the first demo shift is never sooner than this many days away

const toUtcMidnight = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Days to add to every authored demo date, judged by today's date in Toronto. */
export function demoOffsetDays(now = new Date()): number {
  const today = utcToZoned(now, "America/Toronto").date;
  const diff = Math.round((toUtcMidnight(today) + LEAD_DAYS * DAY_MS - toUtcMidnight(AUTHORED_FIRST_DAY)) / DAY_MS);
  return Math.max(0, diff);
}

/** An authored demo date (YYYY-MM-DD), moved forward as needed. */
export function demoDate(iso: string, now = new Date()): string {
  return new Date(toUtcMidnight(iso) + demoOffsetDays(now) * DAY_MS).toISOString().slice(0, 10);
}
