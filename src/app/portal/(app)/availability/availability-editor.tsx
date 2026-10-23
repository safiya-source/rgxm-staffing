"use client";
import { format } from "date-fns";
import { TrashIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addAvailabilityExceptionAction, removeAvailabilityExceptionAction, saveWeeklyAvailabilityAction } from "@/app/portal/actions";
import { Field, FormMessage } from "@/components/app/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useFormAction } from "@/lib/use-form-action";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_INDEX = [1, 2, 3, 4, 5, 6, 0];

type Rule = { weekday: number; startTime: string; endTime: string };
type Exception = { id: string; date: string; kind: "available" | "unavailable"; startTime: string | null; endTime: string | null; note: string | null };

export function AvailabilityEditor({ rules, exceptions }: { rules: Rule[]; exceptions: Exception[] }) {
  const router = useRouter();
  const [week, setWeek] = useState(() =>
    DAY_INDEX.map((weekday) => {
      const r = rules.find((x) => x.weekday === weekday);
      return { weekday, on: Boolean(r), startTime: r?.startTime ?? "09:00", endTime: r?.endTime ?? "21:00" };
    }),
  );
  const [pending, start] = useTransition();
  const [allDay, setAllDay] = useState(true);
  const [state, onSubmit, adding] = useFormAction(async (prev, fd) => {
    const res = await addAvailabilityExceptionAction(prev, fd);
    if (res.ok) {
      toast.success(res.message ?? "Saved");
      router.refresh();
    }
    return res;
  });

  const set = (i: number, patch: Partial<(typeof week)[number]>) => setWeek((w) => w.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  return (
    <>
      <section aria-labelledby="weekly">
        <h2 id="weekly" className="mb-2 text-sm font-medium text-muted-foreground">
          Usually available
        </h2>
        <Card className="divide-y">
          {week.map((d, i) => (
            <div key={d.weekday} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <label className="flex w-32 items-center gap-2.5 text-[15px]">
                <Checkbox checked={d.on} onCheckedChange={(c) => set(i, { on: Boolean(c) })} />
                {DAYS[i]}
              </label>
              {d.on ? (
                <div className="flex items-center gap-2">
                  <Input type="time" value={d.startTime} onChange={(e) => set(i, { startTime: e.target.value })} className="h-9 w-28" aria-label={`${DAYS[i]} from`} />
                  <span className="text-muted-foreground">to</span>
                  <Input type="time" value={d.endTime} onChange={(e) => set(i, { endTime: e.target.value })} className="h-9 w-28" aria-label={`${DAYS[i]} until`} />
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Not usually</span>
              )}
            </div>
          ))}
        </Card>
        <Button
          className="mt-3 w-full"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await saveWeeklyAvailabilityAction(
                week.filter((d) => d.on).map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime })),
              );
              if (res.ok) {
                toast.success(res.message ?? "Saved");
                router.refresh();
              } else toast.error(res.error);
            })
          }
        >
          {pending ? "Saving…" : "Save weekly availability"}
        </Button>
      </section>

      <section aria-labelledby="dates">
        <h2 id="dates" className="mb-2 text-sm font-medium text-muted-foreground">
          Specific dates
        </h2>
        <Card className="p-4">
          <form onSubmit={onSubmit} className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date" htmlFor="ex-date">
                <Input id="ex-date" name="date" type="date" required min={format(new Date(), "yyyy-MM-dd")} />
              </Field>
              <Field label="I'm…" htmlFor="ex-kind">
                <NativeSelect id="ex-kind" name="kind" defaultValue="unavailable">
                  <option value="unavailable">Unavailable</option>
                  <option value="available">Available</option>
                </NativeSelect>
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="allDay" checked={allDay} onCheckedChange={(c) => setAllDay(Boolean(c))} /> All day
            </label>
            {!allDay ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="From" htmlFor="ex-start">
                  <Input id="ex-start" name="startTime" type="time" required />
                </Field>
                <Field label="Until" htmlFor="ex-end">
                  <Input id="ex-end" name="endTime" type="time" required />
                </Field>
              </div>
            ) : null}
            <Field label="Note (optional)" htmlFor="ex-note">
              <Input id="ex-note" name="note" maxLength={200} />
            </Field>
            {!state.ok ? <FormMessage>{state.error}</FormMessage> : null}
            <Button type="submit" variant="outline" disabled={adding}>
              Add date
            </Button>
          </form>
        </Card>
        {exceptions.length ? (
          <Card className="mt-3 divide-y">
            {exceptions.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-[15px] font-medium">{format(new Date(`${e.date}T12:00:00`), "EEEE, MMM d")}</p>
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Badge tone={e.kind === "available" ? "success" : "danger"}>{e.kind === "available" ? "Available" : "Unavailable"}</Badge>
                    {e.startTime && e.endTime ? `${e.startTime}–${e.endTime}` : "All day"}
                    {e.note ? ` · ${e.note}` : ""}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove date"
                  onClick={async () => {
                    const res = await removeAvailabilityExceptionAction(e.id);
                    if (!res.ok) toast.error(res.error);
                    router.refresh();
                  }}
                >
                  <TrashIcon />
                </Button>
              </div>
            ))}
          </Card>
        ) : null}
      </section>
    </>
  );
}
