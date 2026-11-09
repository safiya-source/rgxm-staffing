"use client";
import { useState } from "react";
import { ActionForm } from "@/components/app/action-form";
import { Field } from "@/components/app/form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/format";
import { recordCompensationAction } from "./actions";

type Rates = { breakfast: number; lunch: number; dinner: number; perDiem: number; mileage: string };

export function RecordCompensationForm({
  projectId,
  enabled,
  bookings,
  rates,
}: {
  projectId: string;
  enabled: { meals: boolean; perDiem: boolean; mileage: boolean; bonus: boolean };
  bookings: { value: string; label: string }[];
  rates: Rates;
}) {
  const options = [
    ...(enabled.meals
      ? [
          ["meal_breakfast", `Breakfast allowance (${formatMoney(rates.breakfast)})`],
          ["meal_lunch", `Lunch allowance (${formatMoney(rates.lunch)})`],
          ["meal_dinner", `Dinner allowance (${formatMoney(rates.dinner)})`],
        ]
      : []),
    ...(enabled.perDiem ? [["per_diem", `Full-day per diem (${formatMoney(rates.perDiem)})`]] : []),
    ...(enabled.mileage ? [["mileage", `Mileage ($${Number(rates.mileage).toFixed(2)}/km)`]] : []),
    ...(enabled.bonus ? [["bonus", "Bonus"]] : []),
  ] as [string, string][];
  const [category, setCategory] = useState(options[0]?.[0] ?? "");
  if (!bookings.length) return <p className="text-sm text-muted-foreground">No confirmed or completed shifts on this project yet.</p>;
  return (
    <ActionForm action={recordCompensationAction} hidden={{ projectId }} submitLabel="Record" className="grid gap-4 sm:grid-cols-2">
      <Field label="Contractor and shift" htmlFor="comp-booking">
        <NativeSelect id="comp-booking" name="booking" required>
          {bookings.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="What" htmlFor="comp-category">
        <NativeSelect id="comp-category" name="category" value={category} onChange={(e) => setCategory(e.target.value)}>
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {category === "mileage" ? (
        <>
          <Field label="Kilometres" htmlFor="comp-km" hint="Up to 2 decimals. The amount is km × rate, rounded once to the cent.">
            <Input id="comp-km" name="km" inputMode="decimal" required placeholder="42.5" />
          </Field>
          <Field label="Trip date" htmlFor="comp-trip">
            <Input id="comp-trip" name="tripDate" type="date" required />
          </Field>
          <Field label="Business purpose" htmlFor="comp-purpose" className="sm:col-span-2">
            <Input id="comp-purpose" name="businessPurpose" required placeholder="Drove event kit from the warehouse to the venue" />
          </Field>
        </>
      ) : null}
      {category === "bonus" ? (
        <>
          <Field label="Amount (CAD)" htmlFor="comp-amount">
            <Input id="comp-amount" name="amount" inputMode="decimal" required placeholder="50.00" />
          </Field>
          <Field label="Reason" htmlFor="comp-reason">
            <Textarea id="comp-reason" name="reason" required rows={2} placeholder="Covered a no-show at short notice" />
          </Field>
        </>
      ) : null}
    </ActionForm>
  );
}
