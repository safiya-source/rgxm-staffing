// Wall-clock ↔ instant conversion for shifts. All storage is UTC; every local time is
// interpreted in the IANA time zone of the activation location.
//
// DST behaviour (America/Toronto as example):
//  - spring-forward gap (02:00–03:00 doesn't exist): a time inside the gap moves forward an hour
//  - fall-back fold (01:00–02:00 happens twice): the first (daylight-time) occurrence is used
import { TZDate } from "@date-fns/tz";
import { addDays, format, parseISO } from "date-fns";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isIsoDate(value: string) {
  return DATE_RE.test(value) && !Number.isNaN(parseISO(value).getTime());
}

export function isLocalTime(value: string) {
  return TIME_RE.test(value);
}

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The instant at which the given local date + time occurs in `timeZone`. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  if (!isIsoDate(date)) throw new Error(`Invalid date: ${date}`);
  if (!isLocalTime(time)) throw new Error(`Invalid time: ${time}`);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  return new Date(new TZDate(y, m - 1, d, hh, mm, timeZone).getTime());
}

/** Local calendar date (YYYY-MM-DD) and time (HH:mm) of an instant in `timeZone`. */
export function utcToZoned(instant: Date, timeZone: string) {
  const local = new TZDate(instant.getTime(), timeZone);
  return { date: format(local, "yyyy-MM-dd"), time: format(local, "HH:mm"), weekday: local.getDay() };
}

/** [start, end) instants covering one local calendar day (23 or 25 hours on DST days). */
export function localDayBounds(date: string, timeZone: string): [Date, Date] {
  const next = format(addDays(parseISO(date), 1), "yyyy-MM-dd");
  return [zonedToUtc(date, "00:00", timeZone), zonedToUtc(next, "00:00", timeZone)];
}

/**
 * A shift's instants from a local date and start/end times. An end time at or before the
 * start time means the shift crosses midnight and ends the following day.
 */
export function shiftInstants(date: string, startTime: string, endTime: string, timeZone: string) {
  const crossesMidnight = endTime <= startTime;
  const endDate = crossesMidnight ? format(addDays(parseISO(date), 1), "yyyy-MM-dd") : date;
  const startsAt = zonedToUtc(date, startTime, timeZone);
  const endsAt = zonedToUtc(endDate, endTime, timeZone);
  return { startsAt, endsAt, crossesMidnight, minutes: Math.round((endsAt.getTime() - startsAt.getTime()) / 60000) };
}

export const MAX_BULK_SHIFTS = 400;

export type ShiftPattern = {
  startDate: string;
  endDate: string;
  /** 0 = Sunday … 6 = Saturday. Empty means every day. */
  weekdays: number[];
  startTime: string;
  endTime: string;
  timeZone: string;
};

/** Expands a recurring pattern into concrete shift windows, one per matching local date. */
export function expandShiftPattern(p: ShiftPattern) {
  if (!isIsoDate(p.startDate) || !isIsoDate(p.endDate)) throw new Error("Invalid date range");
  if (p.endDate < p.startDate) throw new Error("End date is before start date");
  if (!isLocalTime(p.startTime) || !isLocalTime(p.endTime)) throw new Error("Invalid time");
  if (p.startTime === p.endTime) throw new Error("Start and end time can't be the same");
  const out: { date: string; startsAt: Date; endsAt: Date; minutes: number; crossesMidnight: boolean }[] = [];
  for (let d = parseISO(p.startDate); format(d, "yyyy-MM-dd") <= p.endDate; d = addDays(d, 1)) {
    if (p.weekdays.length && !p.weekdays.includes(d.getDay())) continue;
    const date = format(d, "yyyy-MM-dd");
    out.push({ date, ...shiftInstants(date, p.startTime, p.endTime, p.timeZone) });
    if (out.length > MAX_BULK_SHIFTS) throw new Error(`That would create more than ${MAX_BULK_SHIFTS} shifts`);
  }
  return out;
}

/** Common Canadian/North American zones for pickers. Any valid IANA zone is accepted. */
export const COMMON_TIME_ZONES = [
  ["America/Toronto", "Eastern (Toronto, Ottawa, Montréal)"],
  ["America/Halifax", "Atlantic (Halifax)"],
  ["America/St_Johns", "Newfoundland (St. John's)"],
  ["America/Winnipeg", "Central (Winnipeg)"],
  ["America/Regina", "Saskatchewan (Regina)"],
  ["America/Edmonton", "Mountain (Calgary, Edmonton)"],
  ["America/Vancouver", "Pacific (Vancouver)"],
  ["America/New_York", "US Eastern (New York)"],
  ["America/Chicago", "US Central (Chicago)"],
  ["America/Los_Angeles", "US Pacific (Los Angeles)"],
] as const;
