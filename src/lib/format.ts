// Display formatting. Money is always integer minor units (cents).
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

export function formatMoney(cents: number, currency = "CAD") {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
}

export function formatRate(centsPerHour: number, currency = "CAD") {
  return `${formatMoney(centsPerHour, currency)}/hr`;
}

/** Formats an instant in a specific IANA time zone (e.g. the activation location's). */
export function formatInZone(instant: Date | string, timeZone: string, pattern = "EEE MMM d, h:mm a") {
  return format(new TZDate(new Date(instant).getTime(), timeZone), pattern);
}

export function formatDateRange(start: string | null, end: string | null) {
  if (!start) return "Dates TBC";
  const s = new Date(`${start}T12:00:00`);
  const e = end ? new Date(`${end}T12:00:00`) : null;
  if (!e || start === end) return format(s, "MMM d, yyyy");
  if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
    return `${format(s, "MMM d")}–${format(e, "d, yyyy")}`;
  }
  return `${format(s, "MMM d")} – ${format(e, "MMM d, yyyy")}`;
}

export function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m.toString().padStart(2, "0")}m`;
}

/** Short zone label for an instant, e.g. "EST" / "EDT". */
export function zoneAbbreviation(instant: Date | string, timeZone: string) {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
    .formatToParts(new Date(instant))
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone;
}
