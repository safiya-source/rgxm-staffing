"use client";
// Open shifts a contractor can apply for without an offer. Applying records interest only: RGXM
// confirms who's booked, exactly as with offers.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { applyForShiftAction } from "@/app/portal/actions";
import { ShiftSummary } from "@/components/portal/shift-summary";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { FIELD_ROLE_NAMES, type FieldRole } from "@/lib/roles";

export type BoardShift = {
  shiftId: string;
  projectName: string;
  role: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  locationName: string;
  city: string | null;
  uniform: string | null;
  spotsLeft: number;
  rateCents: number | null;
};

export function JobBoard({ shifts }: { shifts: BoardShift[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [applying, setApplying] = useState<BoardShift | null>(null);
  const [note, setNote] = useState("");
  const groups = new Map<string, BoardShift[]>();
  for (const s of shifts) {
    const key = `${s.projectName}|${s.role}|${s.locationName}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  return (
    <>
      {[...groups.entries()].map(([key, items]) => {
        const first = items[0]!;
        return (
          <Card key={key} className="overflow-hidden" role="region" aria-label={`${first.projectName}, ${FIELD_ROLE_NAMES[first.role as FieldRole]}`}>
            <div className="border-b bg-muted/40 px-4 py-3">
              <p className="font-semibold">{first.projectName}</p>
              <p className="text-sm text-muted-foreground">
                {FIELD_ROLE_NAMES[first.role as FieldRole]} · {[first.locationName, first.city].filter(Boolean).join(", ")}
              </p>
              {first.uniform ? <p className="mt-1 text-sm text-muted-foreground">Uniform: {first.uniform}</p> : null}
            </div>
            <ul className="divide-y">
              {items.map((s) => (
                <li key={s.shiftId} className="grid gap-3 px-4 py-3">
                  <ShiftSummary startsAt={s.startsAt} endsAt={s.endsAt} timezone={s.timezone} rateCents={s.rateCents} currency="CAD" />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">
                      {s.spotsLeft} spot{s.spotsLeft === 1 ? "" : "s"} open
                    </span>
                    <Button
                      disabled={pending}
                      onClick={() => {
                        setNote("");
                        setApplying(s);
                      }}
                    >
                      I&apos;m interested
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}

      <Dialog open={applying !== null} onOpenChange={(o) => !o && setApplying(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Interested in this shift?</DialogTitle>
            <DialogDescription>RGXM will see that you&apos;re available and confirm who&apos;s booked. You&apos;re not booked until RGXM confirms.</DialogDescription>
          </DialogHeader>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Anything RGXM should know? (optional)" aria-label="Note to RGXM" />
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await applyForShiftAction(applying!.shiftId, note.trim() || undefined);
                  if (res.ok) toast.success(res.message ?? "Sent");
                  else toast.error(res.error);
                  setApplying(null);
                  router.refresh();
                })
              }
            >
              Send to RGXM
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
