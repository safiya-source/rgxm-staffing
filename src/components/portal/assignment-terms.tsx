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
    comp.mealsEnabled ? `Meal allowances: breakfast ${formatMoney(comp.breakfastCents, currency)}, lunch ${formatMoney(comp.lunchCents, currency)}, dinner ${formatMoney(comp.dinnerCents, currency)}` : null,
    comp.perDiemEnabled ? `Full-day per diem: ${formatMoney(comp.perDiemCents, currency)} (not combined with meal allowances on the same day)` : null,
    comp.mileageEnabled ? `Mileage: ${formatMoney(Math.round(Number(comp.mileageRate) * 100), currency)} per approved kilometre` : null,
    comp.bonusEnabled ? "Bonuses may apply when RGXM communicates and approves them" : null,
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
