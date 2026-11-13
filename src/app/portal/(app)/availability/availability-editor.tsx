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
import { choicesToRules, DAY_PART_HINT, DAY_PART_LABEL, DAY_PARTS, rulesToChoices, type DayChoice, type DayPart } from "@/lib/availability";
import { useFormAction } from "@/lib/use-form-action";
import { cn } from "@/lib/utils";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_INDEX = [1, 2, 3, 4, 5, 6, 0];

type Rule = { weekday: number; startTime: string; endTime: string };
type Exception = { id: string; date: string; kind: "available" | "unavailable"; startTime: string | null; endTime: string | null; note: string | null };

export function AvailabilityEditor({ rules, exceptions }: { rules: Rule[]; exceptions: Exception[] }) {
  const router = useRouter();
  const [week, setWeek] = useState<Record<number, DayChoice>>(() => rulesToChoices(rules));
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

  // "Open" means any time, so it replaces the parts of the day, and picking a part turns "Open" off.
  const toggle = (weekday: number, part: DayPart | "open") =>
    setWeek((w) => {
      const c = w[weekday]!;
      const next: DayChoice =
        part === "open" ? { open: !c.open, parts: [] } : { open: false, parts: c.parts.includes(part) ? c.parts.filter((p) => p !== part) : [...c.parts, part] };
      return { ...w, [weekday]: next };
    });
  const chip = (on: boolean) =>
    cn("rounded-full border px-3 py-1.5 text-sm", on ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-accent");

  return (
    <>
      <section aria-labelledby="weekly">
        <h2 id="weekly" className="mb-2 text-sm font-medium text-muted-foreground">
          Usually available
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Tap the times you can usually work each day. {DAY_PARTS.map((p) => `${DAY_PART_LABEL[p]} ${DAY_PART_HINT[p]}`).join(" · ")}.
        </p>
        <Card className="divide-y">
          {DAY_INDEX.map((weekday, i) => {
            const c = week[weekday]!;
            return (
              <div key={weekday} className="grid gap-2 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-medium">{DAYS[i]}</span>
                  <span className="text-xs text-muted-foreground">{c.open ? "Any time" : c.parts.length ? "" : "Not usually"}</span>
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${DAYS[i]} availability`}>
                  {DAY_PARTS.map((part) => (
                    <button key={part} type="button" aria-pressed={c.parts.includes(part)} aria-label={`${DAYS[i]} ${DAY_PART_LABEL[part]}`} onClick={() => toggle(weekday, part)} className={chip(c.parts.includes(part))}>
                      {DAY_PART_LABEL[part]}
                    </button>
                  ))}
                  <button type="button" aria-pressed={c.open} aria-label={`${DAYS[i]} open availability`} onClick={() => toggle(weekday, "open")} className={chip(c.open)}>
                    Open availability
                  </button>
                </div>
              </div>
            );
          })}
        </Card>
        <Button
          className="mt-3 w-full"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await saveWeeklyAvailabilityAction(choicesToRules(week));
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
