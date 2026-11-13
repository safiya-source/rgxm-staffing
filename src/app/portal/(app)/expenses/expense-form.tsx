"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

type Shift = { bookingId: string; projectId: string; projectName: string; label: string };

export function ExpenseForm({ shifts, today }: { shifts: Shift[]; today: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const projects = [...new Map(shifts.map((s) => [s.projectId, s.projectName])).entries()];
  const [projectId, setProjectId] = useState(projects[0]?.[0] ?? "");

  if (!projects.length) return <p className="text-sm text-muted-foreground">Once you&apos;re booked on a shift, you can claim expenses for that project here.</p>;

  return (
    <form
      ref={formRef}
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(undefined);
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await fetch("/api/me/expenses", { method: "POST", body: fd });
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          if (!res.ok) return setError(body.error ?? "Couldn't submit the expense.");
          toast.success("Expense submitted. RGXM will review it.");
          formRef.current?.reset();
          router.refresh();
        });
      }}
    >
      <Field label="Project" htmlFor="ex-project">
        <NativeSelect id="ex-project" name="projectId" value={projectId} onChange={(e) => setProjectId(e.target.value)} required>
          {projects.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Shift (optional)" htmlFor="ex-shift">
        <NativeSelect id="ex-shift" name="bookingId" defaultValue="" key={projectId}>
          <option value="">Not for a specific shift</option>
          {shifts
            .filter((s) => s.projectId === projectId)
            .map((s) => (
              <option key={s.bookingId} value={s.bookingId}>
                {s.label}
              </option>
            ))}
        </NativeSelect>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Purchase date" htmlFor="ex-date">
          <Input id="ex-date" name="purchaseDate" type="date" max={today} defaultValue={today} required />
        </Field>
        <Field label="Total paid (CAD)" htmlFor="ex-amount" hint="Including any tax on the receipt.">
          <Input id="ex-amount" name="amount" inputMode="decimal" placeholder="23.45" required />
        </Field>
      </div>
      <Field label="Store or vendor" htmlFor="ex-vendor">
        <Input id="ex-vendor" name="vendor" placeholder="e.g. Staples" required />
      </Field>
      <Field label="What was it for?" htmlFor="ex-desc">
        <Textarea id="ex-desc" name="description" rows={2} placeholder="e.g. Extra tape and markers for the booth, approved by Sam" required />
      </Field>
      <Field label="Receipt" htmlFor="ex-receipt" hint="A clear photo or PDF of the receipt.">
        <Input id="ex-receipt" name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required />
      </Field>
      {error ? <FormMessage>{error}</FormMessage> : null}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Submitting…" : "Submit for reimbursement"}
      </Button>
    </form>
  );
}
