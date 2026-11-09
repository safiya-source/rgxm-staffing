"use client";
// Allowances, per diems, mileage and bonus for a project. Used on the staffing request form and the
// project Setup page. Plain named inputs: read them with readCompensationForm(FormData).
import { useState } from "react";
import { Field } from "@/components/app/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type CompensationDefaults = {
  mealsEnabled: boolean;
  perDiemEnabled: boolean;
  mileageEnabled: boolean;
  bonusEnabled: boolean;
  breakfastCents: number;
  lunchCents: number;
  dinnerCents: number;
  perDiemCents: number;
  mileageRate: string;
  eligibleMeals: string[];
  bonusCents: number | null;
  bonusConditions: string | null;
  notes: string | null;
};

const dollars = (cents: number) => (cents / 100).toFixed(2);

function Toggle({ name, label, hint, on, onChange }: { name: string; label: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <Label className="flex items-start gap-2 font-normal">
      <Checkbox name={name} checked={on} onCheckedChange={(c) => onChange(c === true)} className="mt-0.5" />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-[13px] text-muted-foreground">{hint}</span>
      </span>
    </Label>
  );
}

export function CompensationFields({ defaults: d, idPrefix = "comp" }: { defaults: CompensationDefaults; idPrefix?: string }) {
  const [on, setOn] = useState({ meals: d.mealsEnabled, perDiem: d.perDiemEnabled, mileage: d.mileageEnabled, bonus: d.bonusEnabled });
  const id = (n: string) => `${idPrefix}-${n}`;
  return (
    <div className="grid gap-5">
      <div className="grid gap-3">
        <Toggle name="mealsEnabled" label="Meal allowances" hint="Breakfast, lunch and/or dinner, at most one of each per person per day." on={on.meals} onChange={(v) => setOn({ ...on, meals: v })} />
        {on.meals ? (
          <div className="ml-6 grid gap-3 sm:grid-cols-3">
            {(
              [
                ["meal_breakfast", "breakfast", "Breakfast", d.breakfastCents],
                ["meal_lunch", "lunch", "Lunch", d.lunchCents],
                ["meal_dinner", "dinner", "Dinner", d.dinnerCents],
              ] as const
            ).map(([key, name, label, cents]) => (
              <div key={key} className="grid gap-1.5">
                <Label className="flex items-center gap-2 font-normal">
                  <Checkbox name={`eligible_${key}`} defaultChecked={d.eligibleMeals.includes(key)} /> {label} eligible
                </Label>
                <Input id={id(name)} name={name} aria-label={`${label} allowance (CAD)`} inputMode="decimal" defaultValue={dollars(cents)} />
              </div>
            ))}
            <p className="text-[13px] text-muted-foreground sm:col-span-3">Untick a meal that&apos;s provided on site.</p>
          </div>
        ) : (
          <>
            <input type="hidden" name="breakfast" value={dollars(d.breakfastCents)} />
            <input type="hidden" name="lunch" value={dollars(d.lunchCents)} />
            <input type="hidden" name="dinner" value={dollars(d.dinnerCents)} />
            {d.eligibleMeals.map((m) => (
              <input key={m} type="hidden" name={`eligible_${m}`} value="on" />
            ))}
          </>
        )}
      </div>

      <div className="grid gap-3">
        <Toggle name="perDiemEnabled" label="Full-day per diem" hint="Instead of meal allowances, never both on the same day." on={on.perDiem} onChange={(v) => setOn({ ...on, perDiem: v })} />
        {on.perDiem ? (
          <Field label="Per diem (CAD per day)" htmlFor={id("perDiem")} className="ml-6 max-w-48">
            <Input id={id("perDiem")} name="perDiem" inputMode="decimal" defaultValue={dollars(d.perDiemCents)} />
          </Field>
        ) : (
          <input type="hidden" name="perDiem" value={dollars(d.perDiemCents)} />
        )}
      </div>

      <div className="grid gap-3">
        <Toggle name="mileageEnabled" label="Mileage" hint="For approved business trips with a kilometre record; not ordinary commuting." on={on.mileage} onChange={(v) => setOn({ ...on, mileage: v })} />
        {on.mileage ? (
          <Field label="Mileage (CAD per km)" htmlFor={id("mileageRate")} className="ml-6 max-w-48">
            <Input id={id("mileageRate")} name="mileageRate" inputMode="decimal" defaultValue={Number(d.mileageRate).toFixed(2)} />
          </Field>
        ) : (
          <input type="hidden" name="mileageRate" value={Number(d.mileageRate).toFixed(2)} />
        )}
      </div>

      <div className="grid gap-3">
        <Toggle name="bonusEnabled" label="Bonus" hint="Shown to contractors before they accept, with its conditions." on={on.bonus} onChange={(v) => setOn({ ...on, bonus: v })} />
        {on.bonus ? (
          <div className="ml-6 grid gap-3 sm:grid-cols-[12rem_1fr]">
            <Field label="Amount (CAD, optional)" htmlFor={id("bonusAmount")} hint="Leave blank if it's calculated">
              <Input id={id("bonusAmount")} name="bonusAmount" inputMode="decimal" defaultValue={d.bonusCents != null ? dollars(d.bonusCents) : ""} />
            </Field>
            <Field label="When it's earned" htmlFor={id("bonusConditions")}>
              <Textarea id={id("bonusConditions")} name="bonusConditions" rows={2} defaultValue={d.bonusConditions ?? ""} placeholder="e.g. $50 for every shift if all sampling targets are met" />
            </Field>
          </div>
        ) : null}
      </div>

      <Field label="Notes for contractors (optional)" htmlFor={id("notes")} hint="e.g. parking reimbursed with receipts; meals provided on the second day">
        <Textarea id={id("notes")} name="compNotes" rows={2} defaultValue={d.notes ?? ""} />
      </Field>
    </div>
  );
}
