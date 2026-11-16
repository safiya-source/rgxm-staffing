// The "settle GST/HST" step on Payments. Lines wait here when Crew can't apply an approved tax rule,
// almost always because a contractor's GST/HST answer is missing or not yet confirmed by Finance.
// Lines are grouped by person so each contractor is sorted out once, not line by line.
import Link from "next/link";
import { ActionForm } from "@/components/app/action-form";
import { DemoBadge } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatMoney } from "@/lib/format";
import { formatRatePpm } from "@/server/domain/money";
import { CATEGORY_LABEL } from "@/server/domain/tax-engine";
import type { ChoosableTaxRule, ReadyPayable } from "@/server/queries/payments";
import { decideTaxForLinesAction, verifyGstAndRecalculateAction } from "./actions";

type Kind = "verify" | "ask" | "decide";
type Group = { staffId: string; staffName: string; kind: Kind; lines: ReadyPayable[] };

const KIND_ORDER: Record<Kind, number> = { verify: 0, ask: 1, decide: 2 };
const KIND_BADGE: Record<Kind, { label: string; tone: "warning" | "info" | "neutral" }> = {
  verify: { label: "Confirm registration", tone: "info" },
  ask: { label: "Waiting on contractor", tone: "warning" },
  decide: { label: "Decide tax", tone: "neutral" },
};

function kindOf(r: ReadyPayable): Kind {
  if (r.gstStatus === "unknown" || r.gstStatus === "unsure") return "ask";
  if ((r.gstStatus === "yes" || r.gstStatus === "no") && r.gstVerification === "unverified") return "verify";
  return "decide";
}

export function groupReview(lines: ReadyPayable[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of lines) {
    const g = map.get(r.staffId) ?? { staffId: r.staffId, staffName: r.staffName, kind: kindOf(r), lines: [] };
    g.lines.push(r);
    map.set(r.staffId, g);
  }
  return [...map.values()].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.staffName.localeCompare(b.staffName));
}

/** Today's rules, one choice per province (and service category), with multi-part taxes combined (e.g. GST + QST). */
function taxChoices(rules: ChoosableTaxRule[], today: string) {
  const current = rules.filter((r) => r.effectiveFrom <= today && (!r.effectiveTo || r.effectiveTo >= today));
  const byKey = new Map<string, ChoosableTaxRule[]>();
  for (const r of current) {
    const k = `${r.jurisdiction}|${r.serviceCategory ?? ""}`;
    const list = byKey.get(k) ?? [];
    if (!list.some((x) => x.component === r.component)) list.push(r);
    byKey.set(k, list);
  }
  return [...byKey.values()].map((list) => ({
    value: list.map((r) => r.id).join(","),
    label:
      `${list.map((r) => `${r.component} ${formatRatePpm(r.ratePpm)}`).join(" + ")} (${list[0]!.jurisdiction})` +
      (list[0]!.serviceCategory ? ` · ${list[0]!.serviceCategory}` : "") +
      (list.some((r) => r.status === "draft") ? " · not yet approved by the accountant" : ""),
  }));
}

function reasonText(r: ReadyPayable) {
  return r.taxBasis?.replace(/^Finance review: /, "").replace(/^./, (c) => c.toUpperCase()) ?? "";
}

function Explanation({ g, autoTax }: { g: Group; autoTax: boolean }) {
  const first = g.lines[0]!;
  if (g.kind === "ask") {
    return (
      <p>
        {first.gstStatus === "unsure" ? "They said they're not sure whether they're registered for GST/HST." : "They haven't told us whether they're registered for GST/HST yet."} Ask them to
        answer it in the Crew portal under Profile → Tax details. Once they answer, confirm it here and their lines update.
      </p>
    );
  }
  if (g.kind === "verify") {
    return first.gstStatus === "yes" ? (
      <p>
        They say they&apos;re registered for GST/HST{first.gstNumber ? <> (number <span className="font-mono">{first.gstNumber}</span>)</> : null}. Look the number up in the
        CRA&apos;s GST/HST Registry on canada.ca, then confirm.{" "}
        {autoTax ? "Crew then adds HST to their lines automatically where the approved rules apply." : "Automatic HST is off until your accountant approves the tax rules, so after confirming you'll choose the tax for their lines here."}
      </p>
    ) : (
      <p>They say they&apos;re not registered for GST/HST. Confirm it and their lines are paid without tax.</p>
    );
  }
  // Lines keep the reason from when they were calculated; describe the person's current status instead
  // when Finance has since confirmed it.
  if (first.gstVerification === "verified") {
    const status = first.gstStatus === "yes" ? `Registered for GST/HST${first.gstNumber ? ` (${first.gstNumber})` : ""}, confirmed by Finance.` : "Not registered for GST/HST, confirmed by Finance.";
    const others = [...new Set(g.lines.map(reasonText))].filter((r) => !/GST\/HST|registration|automatic tax/i.test(r));
    return (
      <p>
        {status} {!autoTax && first.gstStatus === "yes" ? "Automatic HST is off until your accountant approves the tax rules, so choose the tax for their lines." : null} {others.join(" ")}
      </p>
    );
  }
  const reasons = [...new Set(g.lines.map(reasonText))];
  return (
    <ul className="list-disc pl-5">
      {reasons.map((r) => (
        <li key={r}>{r}</li>
      ))}
    </ul>
  );
}

function DecideForm({ g, choices }: { g: Group; choices: { value: string; label: string }[] }) {
  const n = g.lines.length;
  return (
    <ActionForm action={decideTaxForLinesAction} submitLabel={`Apply to ${n} line${n === 1 ? "" : "s"}`}>
      {g.lines.map((l) => (
        <input key={l.id} type="hidden" name="payableId" value={l.id} />
      ))}
      <label className="grid gap-1 text-xs text-muted-foreground">
        Tax to charge
        <NativeSelect name="choice" required defaultValue="" className="h-9 w-72" aria-label={`Tax to charge for ${g.staffName}`}>
          <option value="" disabled>
            Choose…
          </option>
          <option value="none">No GST/HST</option>
          {choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="grid min-w-64 flex-1 gap-1 text-xs text-muted-foreground">
        Why (kept on record)
        <Input name="reason" placeholder="e.g. Registration checked on the CRA registry" aria-label={`Reason for ${g.staffName}`} className="h-9" required />
      </label>
    </ActionForm>
  );
}

function VerifyForms({ g }: { g: Group }) {
  const registered = g.lines[0]!.gstStatus === "yes";
  return (
    <div className="grid gap-2">
      <ActionForm action={verifyGstAndRecalculateAction} hidden={{ staffId: g.staffId, outcome: "verified" }} submitLabel={registered ? "Confirm registered" : "Confirm not registered"}>
        <label className="grid min-w-64 flex-1 gap-1 text-xs text-muted-foreground">
          How you checked (kept on record)
          <Input
            name="reference"
            placeholder={registered ? "e.g. CRA registry lookup 2026-11-16, confirmed" : "e.g. Confirmed with them by email 2026-11-16"}
            aria-label={`How you checked ${g.staffName}`}
            className="h-9"
            required
          />
        </label>
      </ActionForm>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Couldn&apos;t confirm it</summary>
        <ActionForm action={verifyGstAndRecalculateAction} hidden={{ staffId: g.staffId, outcome: "rejected" }} submitLabel="Record as not confirmed" variant="outline" className="mt-2">
          <Input name="reference" placeholder="What you checked" aria-label={`What you checked for ${g.staffName}`} className="h-9 min-w-64 flex-1" required />
        </ActionForm>
      </details>
    </div>
  );
}

export function TaxReview({ lines, rules, canDecide, canVerify, today, autoTax }: { lines: ReadyPayable[]; rules: ChoosableTaxRule[]; canDecide: boolean; canVerify: boolean; today: string; autoTax: boolean }) {
  const groups = groupReview(lines);
  const choices = taxChoices(rules, today);
  const total = lines.reduce((n, l) => n + l.baseCents, 0);
  const currency = lines[0]?.currency ?? "CAD";
  return (
    <Card className="mb-6 overflow-hidden border-warning/40">
      <CardHeader>
        <CardTitle>
          Step 1: Settle GST/HST · {groups.length} {groups.length === 1 ? "person" : "people"}, {lines.length} line{lines.length === 1 ? "" : "s"}, {formatMoney(total, currency)}
        </CardTitle>
        <CardDescription>
          Before anyone is paid, Crew needs to know whether to add HST. That depends on whether the contractor is registered for GST/HST, confirmed by Finance. Sort each person out once
          and all their lines move to <span className="font-medium text-foreground">Ready to pay</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {groups.map((g) => {
          const sum = g.lines.reduce((n, l) => n + l.baseCents, 0);
          const badge = KIND_BADGE[g.kind];
          return (
            <section key={g.staffId} aria-label={g.staffName} className="grid gap-3 rounded-lg border p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>
                  <Link href={`/dashboard/talent/${g.staffId}`} className="font-medium hover:underline">
                    {g.staffName}
                  </Link>
                  <span className="text-muted-foreground">
                    {" "}
                    · {g.lines.length} line{g.lines.length === 1 ? "" : "s"} · {formatMoney(sum, currency)} before tax
                  </span>{" "}
                  {g.lines.some((l) => l.isDemo) ? <DemoBadge /> : null}
                </p>
                <Badge tone={badge.tone}>{badge.label}</Badge>
              </div>
              <div className="text-muted-foreground">
                <Explanation g={g} autoTax={autoTax} />
              </div>
              {g.kind === "verify" && canVerify ? <VerifyForms g={g} /> : null}
              {canDecide ? (
                g.kind === "decide" ? (
                  <DecideForm g={g} choices={choices} />
                ) : (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer font-medium text-foreground">{g.kind === "ask" ? "Already know their status? Decide the tax yourself" : "Can't wait? Decide the tax yourself for these lines"}</summary>
                    <div className="mt-2">
                      <DecideForm g={g} choices={choices} />
                    </div>
                  </details>
                )
              ) : null}
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Show {g.lines.length === 1 ? "the line" : `the ${g.lines.length} lines`}</summary>
                <ul className="mt-2 grid gap-1">
                  {g.lines.map((l) => (
                    <li key={l.id} className="flex flex-wrap justify-between gap-2">
                      <span>
                        {l.serviceDate} · {CATEGORY_LABEL[l.category] ?? l.category} · {l.projectCode}
                      </span>
                      <span className="tabular-nums">{formatMoney(l.baseCents, l.currency)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
