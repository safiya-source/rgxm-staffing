import { ActionForm } from "@/components/app/action-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CompensationSettings } from "@/server/domain/compensation";
import { saveCompensationSettingsAction } from "../compensation/actions";

const dollars = (cents: number) => (cents / 100).toFixed(2);

/** Per-project switches (all off by default) and rates for allowances, mileage and bonuses. */
export function CompensationSettingsCard({ projectId, settings: s, canEdit }: { projectId: string; settings: CompensationSettings; canEdit: boolean }) {
  const switches = [
    ["mealsEnabled", "Meal allowances", s.mealsEnabled],
    ["perDiemEnabled", "Full-day per diems", s.perDiemEnabled],
    ["mileageEnabled", "Mileage", s.mileageEnabled],
    ["bonusEnabled", "Bonuses", s.bonusEnabled],
  ] as const;
  const rates = [
    ["breakfast", "Breakfast (CAD)", dollars(s.breakfastCents)],
    ["lunch", "Lunch (CAD)", dollars(s.lunchCents)],
    ["dinner", "Dinner (CAD)", dollars(s.dinnerCents)],
    ["perDiem", "Full-day per diem (CAD)", dollars(s.perDiemCents)],
    ["mileageRate", "Mileage (CAD per km)", Number(s.mileageRate).toFixed(2)],
  ] as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Allowances, mileage & bonuses</CardTitle>
        <CardDescription>
          Off unless switched on for this project. Changing a rate only affects items recorded afterwards. How these are taxed and reported at year end follows the
          accountant-approved treatment for each category.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={saveCompensationSettingsAction} hidden={{ projectId }} submitLabel="Save" keep disabled={!canEdit} className="grid gap-4">
          <fieldset disabled={!canEdit} className="grid gap-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {switches.map(([name, label, on]) => (
                <Label key={name} className="flex items-center gap-2 font-normal">
                  <Checkbox name={name} defaultChecked={on} /> {label}
                </Label>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {rates.map(([name, label, value]) => (
                <div key={name} className="grid gap-1.5">
                  <Label htmlFor={`comp-${name}`}>{label}</Label>
                  <Input id={`comp-${name}`} name={name} inputMode="decimal" defaultValue={value} required />
                </div>
              ))}
            </div>
          </fieldset>
        </ActionForm>
      </CardContent>
    </Card>
  );
}
