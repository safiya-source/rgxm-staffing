// The assignment-level terms the Independent Contractor Agreement (section 2) says a confirmation must
// show: payment terms and any approved meals, per diem, mileage or bonus for the project.
import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { getCompensationSettings } from "@/server/domain/compensation";
import { getOrgSettings } from "@/server/settings";

export async function AssignmentTerms({ projectId, currency }: { projectId: string; currency: string }) {
  const [settings, comp] = await Promise.all([getOrgSettings(), getCompensationSettings(projectId)]);
  const terms = settings.paymentTerms?.approvedAt ? settings.paymentTerms : null;
  const allowances = [
    comp.mealsEnabled && comp.eligibleMeals.length
      ? `Meal allowances: ${(
          [
            ["meal_breakfast", "breakfast", comp.breakfastCents],
            ["meal_lunch", "lunch", comp.lunchCents],
            ["meal_dinner", "dinner", comp.dinnerCents],
          ] as const
        )
          .filter(([k]) => comp.eligibleMeals.includes(k))
          .map(([, label, cents]) => `${label} ${formatMoney(cents, currency)}`)
          .join(", ")}`
      : null,
    comp.perDiemEnabled ? `Full-day per diem: ${formatMoney(comp.perDiemCents, currency)} (not combined with meal allowances on the same day)` : null,
    comp.mileageEnabled ? `Mileage: ${formatMoney(Math.round(Number(comp.mileageRate) * 100), currency)} per approved kilometre` : null,
    comp.bonusEnabled ? `Bonus${comp.bonusCents != null ? ` ${formatMoney(comp.bonusCents, currency)}` : ""}: ${comp.bonusConditions ?? "as communicated by RGXM"}` : null,
  ].filter((x): x is string => Boolean(x));
  return (
    <>
      <div>
        <dt className="text-xs text-muted-foreground">Payment terms</dt>
        <dd>{terms?.description ?? "RGXM will confirm the payment schedule."}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Allowances on this project</dt>
        <dd>
          {allowances.length ? (
            <ul className="list-disc pl-5">
              {allowances.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          ) : (
            "None, unless RGXM approves one in writing."
          )}
          {comp.notes ? <span className="mt-1 block whitespace-pre-line">{comp.notes}</span> : null}
          <span className="block text-xs text-muted-foreground">Allowances are paid only when recorded and approved for the work date.</span>
        </dd>
      </div>
      <p className="text-xs text-muted-foreground">
        This assignment is covered by your{" "}
        <Link href="/contractor-agreement" className="underline underline-offset-2">
          Independent Contractor Agreement
        </Link>
        .
      </p>
    </>
  );
}
