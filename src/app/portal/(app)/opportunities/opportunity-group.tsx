"use client";
import { formatDistanceToNowStrict } from "date-fns";
import { HourglassIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { respondToAllAction, respondToOfferAction, withdrawFromBookingAction } from "@/app/portal/actions";
import { ShiftSummary } from "@/components/portal/shift-summary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { formatInZone, formatMoney } from "@/lib/format";
import { FIELD_ROLE_NAMES, type FieldRole } from "@/lib/roles";

type Item = {
  id: string;
  status: string;
  role: string;
  startsAt: string;
  endsAt: string;
  offeredRateCents: number | null;
  currency: string;
  responseDeadline: string | null;
  waitlistPosition: number | null;
  projectName: string;
  timezone: string;
  locationName: string;
  address: string | null;
  uniform: string | null;
  instructions: string | null;
  askedQuestion: boolean;
};

export function OpportunityGroup({ items }: { items: Item[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState<Item | null>(null);
  const [withdrawing, setWithdrawing] = useState<Item | null>(null);
  const [text, setText] = useState("");
  const [now] = useState(() => Date.now());
  const first = items[0]!;
  const open = items.filter((i) => i.status === "offered" && (!i.responseDeadline || new Date(i.responseDeadline).getTime() > now));
  const rates = [...new Set(items.map((i) => i.offeredRateCents))];
  const deadline = open.map((i) => i.responseDeadline).filter(Boolean).sort()[0];

  function done(res: ActionResult) {
    if (res.ok) toast.success(res.message ?? "Saved");
    else toast.error(res.error);
    router.refresh();
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b bg-muted/40 px-4 py-3">
        <p className="font-semibold">{first.projectName}</p>
        <p className="text-sm text-muted-foreground">
          {FIELD_ROLE_NAMES[first.role as FieldRole]} · {[first.locationName, first.address].filter(Boolean).join(", ")}
        </p>
        <p className="mt-1 text-sm">
          {rates.length === 1 && rates[0] != null ? <span className="font-medium">{formatMoney(rates[0], first.currency)}/hour</span> : null}
          {deadline ? (
            <span className="ml-2 text-muted-foreground">
              · Reply within {formatDistanceToNowStrict(new Date(deadline))} ({formatInZone(deadline, first.timezone, "EEE MMM d, h:mm a")})
            </span>
          ) : null}
        </p>
        {first.uniform ? <p className="mt-1 text-sm text-muted-foreground">Uniform: {first.uniform}</p> : null}
      </div>
      <ul className="divide-y">
        {items.map((i) => {
          const closed = i.status === "offered" && i.responseDeadline && new Date(i.responseDeadline).getTime() <= now;
          return (
            <li key={i.id} className="grid gap-3 px-4 py-3">
              <ShiftSummary startsAt={i.startsAt} endsAt={i.endsAt} timezone={i.timezone} rateCents={rates.length > 1 ? i.offeredRateCents : null} currency={i.currency} />
              {i.status === "offered" && !closed ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button size="lg" disabled={pending} onClick={() => start(async () => done(await respondToOfferAction(i.id, "interested")))}>
                    I&apos;m interested
                  </Button>
                  <Button size="lg" variant="outline" disabled={pending} onClick={() => start(async () => done(await respondToOfferAction(i.id, "unavailable")))}>
                    Can&apos;t make it
                  </Button>
                  <button className="col-span-2 cursor-pointer text-sm text-muted-foreground underline-offset-4 hover:underline" onClick={() => setAsking(i)}>
                    {i.askedQuestion ? "Ask another question" : "Need more info?"}
                  </button>
                </div>
              ) : closed ? (
                <p className="text-sm text-muted-foreground">This offer has closed.</p>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={i.status === "waitlisted" ? "neutral" : "brand"}>
                    <HourglassIcon />
                    {i.status === "waitlisted" ? `Waitlist${i.waitlistPosition ? ` #${i.waitlistPosition}` : ""}` : "Interested · waiting for RGXM"}
                  </Badge>
                  <button className="cursor-pointer text-sm text-muted-foreground hover:text-foreground" onClick={() => setWithdrawing(i)}>
                    I can&apos;t make it anymore
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {open.length > 1 ? (
        <div className="border-t bg-muted/30 px-4 py-3">
          <Button
            variant="outline"
            className="w-full"
            disabled={pending}
            onClick={() => start(async () => done(await respondToAllAction(open.map((i) => i.id), "interested")))}
          >
            I&apos;m interested in all {open.length}
          </Button>
        </div>
      ) : null}

      <Dialog open={asking !== null} onOpenChange={(o) => !o && setAsking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ask RGXM a question</DialogTitle>
            <DialogDescription>The offer stays open while you wait for an answer. Replies appear in Messages.</DialogDescription>
          </DialogHeader>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="e.g. Is parking available?" aria-label="Your question" />
          <DialogFooter>
            <Button
              disabled={pending || !text.trim()}
              onClick={() =>
                start(async () => {
                  done(await respondToOfferAction(asking!.id, "more_info", text));
                  setText("");
                  setAsking(null);
                })
              }
            >
              Send question
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={withdrawing !== null} onOpenChange={(o) => !o && setWithdrawing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Can&apos;t make it?</DialogTitle>
            <DialogDescription>Let RGXM know so they can offer the spot to someone else.</DialogDescription>
          </DialogHeader>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="A short reason" aria-label="Reason" />
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={pending || !text.trim()}
              onClick={() =>
                start(async () => {
                  done(await withdrawFromBookingAction(withdrawing!.id, text));
                  setText("");
                  setWithdrawing(null);
                })
              }
            >
              Let RGXM know
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
