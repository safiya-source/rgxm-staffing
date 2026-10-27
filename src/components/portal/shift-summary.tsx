import { ClockIcon, MapPinIcon } from "lucide-react";
import { formatInZone, formatMoney } from "@/lib/format";
import { utcToZoned } from "@/lib/time";

/** Compact date block + time + place, used across portal lists. */
export function ShiftSummary({
  startsAt,
  endsAt,
  timezone,
  locationName,
  rateCents,
  currency = "CAD",
}: {
  startsAt: Date | string;
  endsAt: Date | string;
  timezone: string;
  locationName?: string;
  rateCents?: number | null;
  currency?: string;
}) {
  const overnight = utcToZoned(new Date(endsAt), timezone).date !== utcToZoned(new Date(startsAt), timezone).date;
  return (
    <div className="flex min-w-0 gap-3">
      <div className="flex w-12 shrink-0 flex-col items-center rounded-lg bg-secondary py-1.5 leading-none">
        <span className="text-[11px] font-medium text-muted-foreground uppercase">{formatInZone(startsAt, timezone, "EEE")}</span>
        <span className="mt-1 text-lg font-semibold">{formatInZone(startsAt, timezone, "d")}</span>
        <span className="text-[11px] text-muted-foreground">{formatInZone(startsAt, timezone, "MMM")}</span>
      </div>
      <div className="min-w-0 flex-1 text-[15px]">
        <p className="flex items-center gap-1.5 font-medium">
          <ClockIcon className="size-4 text-muted-foreground" />
          {formatInZone(startsAt, timezone, "h:mm a")} – {formatInZone(endsAt, timezone, "h:mm a")}
          {overnight ? <span className="text-xs font-normal text-warning">next day</span> : null}
        </p>
        {locationName ? (
          <p className="mt-0.5 flex items-start gap-1.5 text-muted-foreground">
            <MapPinIcon className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 break-words">{locationName}</span>
          </p>
        ) : null}
        {rateCents != null ? <p className="mt-0.5 text-sm text-muted-foreground">{formatMoney(rateCents, currency)}/hour</p> : null}
      </div>
    </div>
  );
}
