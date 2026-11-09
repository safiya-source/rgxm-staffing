"use client";
import { formatDistanceToNowStrict } from "date-fns";
import { CloudOffIcon, LogInIcon, LogOutIcon, MapPinIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { recordMyAttendanceAction } from "@/app/portal/actions";
import { Button } from "@/components/ui/button";
import { formatInZone } from "@/lib/format";
import { getLocationOnce, isNetworkError, queueSnapshot, readQueue, serverQueueSnapshot, subscribeQueue, writeQueue, type QueuedEvent } from "@/lib/offline-attendance";

export type CheckInState = "before_window" | "can_check_in" | "checked_in" | "checked_out" | "closed";

export function CheckInPanel({
  bookingId,
  state,
  opensAt,
  checkedInAt,
  timezone,
  requireLocation,
  locationRetentionDays = null,
}: {
  bookingId: string;
  state: CheckInState;
  opensAt: string;
  checkedInAt: string | null;
  timezone: string;
  requireLocation: boolean;
  locationRetentionDays?: number | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // The browser's location prompt only appears after the person has read why we ask (once per device).
  const [explain, setExplain] = useState<"check_in" | "check_out" | null>(null);
  const queued = useSyncExternalStore(subscribeQueue, queueSnapshot, serverQueueSnapshot);
  const mine = queued.filter((q) => q.bookingId === bookingId);
  // While something is waiting to sync, show the state the person expects.
  const effective: CheckInState = mine.some((q) => q.type === "check_out") ? "checked_out" : mine.some((q) => q.type === "check_in") ? "checked_in" : state;

  const flush = useCallback(async () => {
    const items = readQueue();
    if (!items.length) return;
    const remaining: QueuedEvent[] = [];
    for (const item of items) {
      try {
        const res = await recordMyAttendanceAction(item.bookingId, { type: item.type, clientEventId: item.clientEventId, occurredAt: item.occurredAt, location: item.location });
        if (!res.ok) toast.error(`Couldn't sync a ${item.type === "check_in" ? "check-in" : "check-out"}: ${res.error}`);
        else if (!res.data?.duplicate) toast.success(`${item.type === "check_in" ? "Check-in" : "Check-out"} synced.`);
      } catch (err) {
        if (isNetworkError(err)) remaining.push(item);
        else throw err;
      }
    }
    writeQueue(remaining);
    if (remaining.length !== items.length) router.refresh();
  }, [router]);

  useEffect(() => {
    void flush();
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flush]);

  function start(type: "check_in" | "check_out") {
    let seen = false;
    try {
      seen = localStorage.getItem("rgxm.location-explained") === "1";
    } catch {
      // Storage unavailable (private mode): explain every time.
    }
    if (requireLocation && !seen) setExplain(type);
    else void tap(type);
  }

  function continueAfterExplanation(share: boolean) {
    const type = explain!;
    setExplain(null);
    try {
      localStorage.setItem("rgxm.location-explained", "1");
    } catch {
      // ignore
    }
    void tap(type, share);
  }

  async function tap(type: "check_in" | "check_out", share = true) {
    setBusy(true);
    // A denied or failed location never blocks the check-in; it's flagged for a manual check.
    const location = requireLocation && share ? await getLocationOnce() : null;
    const event: QueuedEvent = { bookingId, type, clientEventId: crypto.randomUUID(), occurredAt: new Date().toISOString(), location };
    try {
      // Online: let the server stamp the time.
      const res = await recordMyAttendanceAction(bookingId, { type, clientEventId: event.clientEventId, location });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(res.message ?? "Done");
        if (requireLocation && res.data?.withinGeofence === false) {
          toast.info(location ? "You appear to be away from the venue. Your Team Lead may check with you." : "Location wasn't shared. That's okay; your Team Lead may confirm you're on site.");
        }
        router.refresh();
      }
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      writeQueue([...readQueue(), event]);
      toast.info("No connection. Saved on this phone with the current time; it will sync automatically.");
    } finally {
      setBusy(false);
    }
  }

  if (explain) {
    return (
      <div className="grid gap-3 rounded-lg border bg-card p-4 text-sm" role="dialog" aria-labelledby="loc-why">
        <p id="loc-why" className="flex items-center gap-2 font-medium">
          <MapPinIcon className="size-4" /> Why this venue asks for your location
        </p>
        <ul className="grid list-disc gap-1 pl-5 text-muted-foreground">
          <li>It confirms you&apos;re at the venue when you check in or out, so your hours can be approved quickly.</li>
          <li>Your phone shares it once, at the moment you tap. It&apos;s never tracked in the background.</li>
          <li>{locationRetentionDays ? `RGXM keeps the coordinates for ${locationRetentionDays} days, then deletes them. The check-in time stays with your hours.` : "RGXM keeps the coordinates only as long as its retention policy allows; the check-in time stays with your hours."}</li>
          <li>If you say no or it doesn&apos;t work, you can still check in. Your Team Lead or RGXM will confirm you were on site, and your pay isn&apos;t affected.</li>
        </ul>
        <p className="text-muted-foreground">Next, your browser will ask for permission.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => continueAfterExplanation(true)}>
            Continue
          </Button>
          <Button size="sm" variant="outline" onClick={() => continueAfterExplanation(false)}>
            {explain === "check_in" ? "Check in without location" : "Check out without location"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {mine.length ? (
        <p className="flex items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          <CloudOffIcon className="size-4" /> Saved on this phone. Waiting to sync.
        </p>
      ) : null}
      {effective === "before_window" ? (
        <p className="text-sm text-muted-foreground">
          Check-in opens {formatInZone(opensAt, timezone, "h:mm a")} ({formatDistanceToNowStrict(new Date(opensAt), { addSuffix: true })}).
        </p>
      ) : effective === "can_check_in" ? (
        <Button size="lg" className="w-full" disabled={busy} onClick={() => start("check_in")}>
          <LogInIcon /> {busy ? "Checking in…" : "Check in"}
        </Button>
      ) : effective === "checked_in" ? (
        <>
          <p className="text-sm text-success">Checked in{checkedInAt ? ` at ${formatInZone(checkedInAt, timezone, "h:mm a")}` : ""}.</p>
          <Button size="lg" variant="outline" className="w-full" disabled={busy} onClick={() => start("check_out")}>
            <LogOutIcon /> {busy ? "Checking out…" : "Check out"}
          </Button>
        </>
      ) : effective === "checked_out" ? (
        <p className="text-sm text-muted-foreground">You&apos;ve checked out. Review your hours below.</p>
      ) : (
        <p className="text-sm text-muted-foreground">Check-in has closed for this shift.</p>
      )}
      {requireLocation && (effective === "can_check_in" || effective === "checked_in") ? (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <MapPinIcon className="mt-0.5 size-3.5 shrink-0" /> This venue asks for your location when you tap. It&apos;s only taken at that moment, never tracked{locationRetentionDays ? `, and deleted after ${locationRetentionDays} days` : ""}.
        </p>
      ) : null}
    </div>
  );
}
