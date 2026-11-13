import type { Metadata } from "next";
import { ActionForm } from "@/components/app/action-form";
import { Field } from "@/components/app/form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInZone, formatMoney } from "@/lib/format";
import { PROVINCES } from "@/lib/provinces";
import { TAX_COMPONENTS } from "@/server/db/schema";
import { getAccountingConfig } from "@/server/domain/billing";
import { formatRatePpm } from "@/server/domain/money";
import { getTaxSetup } from "@/server/domain/tax-config";
import { CATEGORY_LABEL, NEVER_TAXED_CATEGORIES } from "@/server/domain/tax-engine";

const NEVER_TAXED = new Set<string>(NEVER_TAXED_CATEGORIES);
import { requireInternal } from "@/server/session";
import { getOrgSettings } from "@/server/settings";
import {
  approveServiceCategoryAction,
  approveTaxRuleAction,
  approveTreatmentAction,
  createTaxRuleAction,
  retireTaxRuleAction,
  saveAccountingConfigAction,
  saveServiceCategoryAction,
  saveThresholdAction,
  saveTreatmentAction,
  setAutoTaxAction,
  setRecoverabilityAction,
} from "./actions";

export const metadata: Metadata = { title: "Tax & accounting" };

const day = (d: Date | string | null | undefined) => (d ? formatInZone(d, "America/Toronto", "MMM d, yyyy") : "—");
const GST_LABEL: Record<string, string> = { taxable: "GST/HST applies (registered contractors)", not_taxable: "No GST/HST", review: "Not decided (Finance review)" };
const YEAR_END_LABEL: Record<string, string> = { box_048: "Box 048 fees", other_box: "Another box", exclude: "Not reported", review: "Not decided" };

export default async function TaxSettingsPage() {
  await requireInternal("tax.configure");
  const [setup, accounting, settings] = await Promise.all([getTaxSetup(), getAccountingConfig(), getOrgSettings()]);
  const approvedRules = setup.rules.filter((r) => r.status === "approved").length;
  const approvedCategories = setup.categories.filter((c) => c.approvedAt).length;
  const approvedTreatments = setup.treatments.filter((t) => t.approvedAt).length;
  const approvals = [approvedRules > 0, approvedCategories > 0, ...setup.treatments.map((t) => Boolean(t.approvedAt))];
  const taxCodeRows = [...Object.entries(accounting.taxCodes), ["", ""], ["", ""], ["", ""]];

  return (
    <div className="grid max-w-5xl gap-6">
      <p role="note" className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning">
        Everything on this page is a tax or accounting decision for RGXM&apos;s accountant. Record what they approved (and where, e.g. &ldquo;accountant&apos;s email of
        2026-11-20&rdquo;). Until automatic calculation is on and each piece is approved, new bill lines go to Finance for a manual tax decision.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Automatic tax calculation</CardTitle>
          <CardDescription>
            Status: <strong>{setup.autoTaxEnabled ? "on" : "off"}</strong> — {approvals.filter(Boolean).length} of {approvals.length} approvals recorded ({approvedRules} approved rule
            {approvedRules === 1 ? "" : "s"}, {approvedCategories} approved service categor{approvedCategories === 1 ? "y" : "ies"}, {approvedTreatments} of {setup.treatments.length}{" "}
            category treatments).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {setup.autoTaxEnabled ? (
            <>
              <p className="text-sm text-muted-foreground">
                Turned on {day(setup.autoTaxApprovedAt)} · {setup.autoTaxApprovalReference ?? "—"}
              </p>
              <ActionForm action={setAutoTaxAction} hidden={{ enabled: "false" }} submitLabel="Turn off" variant="outline" confirm="Turn off automatic tax? New lines will need a Finance decision.">
                <Input name="reference" aria-label="Reason" placeholder="Reason (optional)" className="w-72" />
              </ActionForm>
            </>
          ) : (
            <ActionForm action={setAutoTaxAction} hidden={{ enabled: "true" }} submitLabel="Turn on">
              <Input name="reference" aria-label="Accountant sign-off" placeholder="Accountant's sign-off (who and when)" className="w-80" required />
            </ActionForm>
          )}
          <p className="text-sm text-muted-foreground">
            Even when on, tax is only calculated for verified registrations, onsite work in the event province, approved service categories and approved category treatments.
            Everything else goes to Finance.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Service categories</CardTitle>
          <CardDescription>The kind of work a project is. &ldquo;Event province&rdquo; means tax follows where the event is; &ldquo;Finance review&rdquo; always goes to Finance.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {setup.categories.map((c) => (
            <div key={c.key} className="grid gap-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.label}</span>
                <Badge tone="outline">{c.placeOfSupplyRule === "event_province" ? "Event province" : "Finance review"}</Badge>
                <Badge tone={c.approvedAt ? "success" : "warning"}>{c.approvedAt ? `Approved ${day(c.approvedAt)}` : "Not approved"}</Badge>
                <span className="text-xs text-muted-foreground">{c.key}</span>
              </div>
              {c.description ? <p className="text-sm text-muted-foreground">{c.description}</p> : null}
              {c.approvalReference ? <p className="text-xs text-muted-foreground">Approval: {c.approvalReference}</p> : null}
              {!c.approvedAt ? (
                <ActionForm action={approveServiceCategoryAction} hidden={{ key: c.key }} submitLabel="Approve">
                  <Input name="reference" aria-label="Approval reference" placeholder="Accountant approval (who and when)" className="w-80" required />
                </ActionForm>
              ) : null}
              <details>
                <summary className="cursor-pointer text-sm text-muted-foreground">Edit (clears approval)</summary>
                <CategoryForm category={c} />
              </details>
            </div>
          ))}
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">Add a service category</summary>
            <CategoryForm />
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tax rules</CardTitle>
          <CardDescription>Rates by province, with the dates they apply. Rules are never edited: add a new rule and retire the old one. Existing lines keep their tax.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Province</TableHead>
                  <TableHead>Tax</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Applies to</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {setup.rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.jurisdiction}</TableCell>
                    <TableCell>{r.component}</TableCell>
                    <TableCell className="tabular-nums">{formatRatePpm(r.ratePpm)}</TableCell>
                    <TableCell className="text-sm">{r.serviceCategory ? (setup.categories.find((c) => c.key === r.serviceCategory)?.label ?? r.serviceCategory) : "All categories"}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {r.effectiveFrom} → {r.effectiveTo ?? "open"}
                    </TableCell>
                    <TableCell>
                      <Badge tone={r.status === "approved" ? "success" : r.status === "draft" ? "warning" : "neutral"}>{r.status}</Badge>
                      {r.approvalReference ? <p className="mt-1 text-xs text-muted-foreground">{r.approvalReference}</p> : null}
                      {r.notes ? <p className="mt-1 text-xs text-muted-foreground">{r.notes}</p> : null}
                    </TableCell>
                    <TableCell>
                      {r.status === "draft" ? (
                        <ActionForm action={approveTaxRuleAction} hidden={{ ruleId: r.id }} submitLabel="Approve">
                          <Input name="reference" aria-label="Approval reference" placeholder="Accountant approval" className="w-48" required />
                        </ActionForm>
                      ) : r.status === "approved" ? (
                        <ActionForm action={retireTaxRuleAction} hidden={{ ruleId: r.id }} submitLabel="Retire" variant="outline">
                          <Input name="reason" aria-label="Reason" placeholder="Reason" className="w-40" required />
                        </ActionForm>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">Add a draft rule</summary>
            <ActionForm action={createTaxRuleAction} submitLabel="Add draft rule" className="mt-3">
              <div className="grid w-full gap-3 sm:grid-cols-3">
                <Field label="Province" htmlFor="tr-j">
                  <NativeSelect id="tr-j" name="jurisdiction" defaultValue="ON">
                    {PROVINCES.map(([code, name]) => (
                      <option key={code} value={code}>
                        {name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Tax" htmlFor="tr-c">
                  <NativeSelect id="tr-c" name="component" defaultValue="HST">
                    {TAX_COMPONENTS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Rate (%)" htmlFor="tr-rate">
                  <Input id="tr-rate" name="ratePercent" inputMode="decimal" placeholder="e.g. 13 or 9.975" />
                </Field>
                <Field label="Service category" htmlFor="tr-sc">
                  <NativeSelect id="tr-sc" name="serviceCategory" defaultValue="">
                    <option value="">All categories</option>
                    {setup.categories.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Applies from" htmlFor="tr-from">
                  <Input id="tr-from" name="effectiveFrom" type="date" />
                </Field>
                <Field label="Until (optional)" htmlFor="tr-to">
                  <Input id="tr-to" name="effectiveTo" type="date" />
                </Field>
                <Field label="Notes (optional)" htmlFor="tr-notes" className="sm:col-span-3">
                  <Input id="tr-notes" name="notes" />
                </Field>
              </div>
            </ActionForm>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Treatment by compensation category</CardTitle>
          <CardDescription>
            For each kind of payment: whether GST/HST applies, and how it&apos;s reported at year end. RGXM charges GST/HST only on hourly fees and bonuses, so meal
            allowances, per diems and mileage are never taxed. Until the accountant approves a treatment, year-end totals list that category as &ldquo;needs accountant
            decision&rdquo;.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {setup.treatments.map((t) => (
            <div key={t.category} className="grid gap-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{CATEGORY_LABEL[t.category] ?? t.category}</span>
                <Badge tone={t.approvedAt ? "success" : "warning"}>{t.approvedAt ? `Approved ${day(t.approvedAt)}` : "Not approved"}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Sales tax: {NEVER_TAXED.has(t.category) ? "Never charged (RGXM policy)" : GST_LABEL[t.gstHst]} · Year end: {YEAR_END_LABEL[t.yearEnd]}
                {t.yearEndBox ? ` (box ${t.yearEndBox})` : ""}
                {t.approvalReference ? ` · ${t.approvalReference}` : ""}
              </p>
              {t.notes ? <p className="text-xs text-muted-foreground">{t.notes}</p> : null}
              <ActionForm
                action={saveTreatmentAction}
                hidden={NEVER_TAXED.has(t.category) ? { category: t.category, gstHst: "not_taxable" } : { category: t.category }}
                submitLabel="Save"
                variant="outline"
                keep
              >
                {NEVER_TAXED.has(t.category) ? null : (
                  <NativeSelect name="gstHst" defaultValue={t.gstHst} aria-label="Sales tax" className="w-64">
                    {Object.entries(GST_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </NativeSelect>
                )}
                <NativeSelect name="yearEnd" defaultValue={t.yearEnd} aria-label="Year end" className="w-44">
                  {Object.entries(YEAR_END_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </NativeSelect>
                <Input name="yearEndBox" aria-label="Box number" placeholder="Box (if another box)" defaultValue={t.yearEnd === "other_box" ? (t.yearEndBox ?? "") : ""} className="w-40" />
                <Input name="notes" aria-label="Notes" placeholder="Notes" defaultValue={t.notes ?? ""} className="w-56" />
              </ActionForm>
              {!t.approvedAt ? (
                <ActionForm action={approveTreatmentAction} hidden={{ category: t.category }} submitLabel="Approve">
                  <Input name="reference" aria-label="Approval reference" placeholder="Accountant approval (who and when)" className="w-80" required />
                </ActionForm>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Can RGXM recover these taxes?</CardTitle>
          <CardDescription>Used in project cost reports to separate recoverable tax (input tax credits) from tax that&apos;s a real cost. Ask the accountant.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={setRecoverabilityAction} submitLabel="Save" keep>
            {TAX_COMPONENTS.map((c) => (
              <Field key={c} label={c} htmlFor={`rec-${c}`}>
                <NativeSelect id={`rec-${c}`} name={c} defaultValue={setup.taxRecoverability[c] ?? "unconfirmed"} className="w-44">
                  <option value="unconfirmed">Not confirmed</option>
                  <option value="recoverable">Recoverable</option>
                  <option value="non_recoverable">Not recoverable</option>
                </NativeSelect>
              </Field>
            ))}
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accounting export</CardTitle>
          <CardDescription>
            Account and tax code names used in the bills file for RGXM&apos;s accounting system. Tick &ldquo;validated&rdquo; only after a test import worked in that system.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-sm">
            Format: {accounting.validatedAt ? <Badge tone="success">Validated {day(accounting.validatedAt)}</Badge> : <Badge tone="warning">Not validated with RGXM&apos;s system</Badge>}
          </p>
          <ActionForm action={saveAccountingConfigAction} submitLabel="Save accounting settings" keep>
            <div className="grid w-full gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Accounting system" htmlFor="acc-system">
                  <Input id="acc-system" name="system" defaultValue={accounting.system ?? ""} placeholder="e.g. QuickBooks Online" />
                </Field>
                <Field label="Currency" htmlFor="acc-currency">
                  <Input id="acc-currency" name="currency" defaultValue={accounting.currency} maxLength={3} className="w-24" />
                </Field>
              </div>
              <fieldset className="grid gap-3 sm:grid-cols-2">
                <legend className="mb-2 text-sm font-medium">Expense account per category</legend>
                {Object.entries(accounting.accounts).map(([k, v]) => (
                  <Field key={k} label={CATEGORY_LABEL[k] ?? k} htmlFor={`acc-${k}`}>
                    <Input id={`acc-${k}`} name={`account:${k}`} defaultValue={v} />
                  </Field>
                ))}
              </fieldset>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">Tax codes</legend>
                <p className="text-xs text-muted-foreground">
                  Key is &ldquo;none&rdquo; for no tax, or TAX:PROVINCE (e.g. HST:ON; several joined with +, e.g. GST:QC+QST:QC). Clear a row to remove it. Save to get more empty rows.
                </p>
                {taxCodeRows.map(([k, v], i) => (
                  <div key={i} className="flex flex-wrap gap-2">
                    <Input name="taxCodeKey" aria-label="Tax key" defaultValue={k} placeholder="e.g. HST:ON" className="w-48" />
                    <Input name="taxCodeValue" aria-label="Tax code in accounting system" defaultValue={v} placeholder="e.g. HST ON" className="w-48" />
                  </div>
                ))}
              </fieldset>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="validated" defaultChecked={Boolean(accounting.validatedAt)} className="size-4" />
                A test import of this format worked in our accounting system
              </label>
            </div>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Year-end threshold</CardTitle>
          <CardDescription>Contractors whose box 048 candidate fees are over this amount are flagged in the year-end review. Currently {formatMoney(settings.yearEndThresholdCents)}.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={saveThresholdAction} submitLabel="Save" keep>
            <Field label="Threshold (CAD)" htmlFor="ye-threshold">
              <Input id="ye-threshold" name="threshold" inputMode="decimal" defaultValue={(settings.yearEndThresholdCents / 100).toFixed(2)} className="w-32" />
            </Field>
            <Field label="Confirmed by" htmlFor="ye-ref">
              <Input id="ye-ref" name="reference" placeholder="Accountant confirmation" className="w-72" />
            </Field>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}

function CategoryForm({ category }: { category?: { key: string; label: string; description: string | null; placeOfSupplyRule: string } }) {
  const p = category?.key ?? "new";
  return (
    <ActionForm action={saveServiceCategoryAction} hidden={category ? { key: category.key } : undefined} submitLabel="Save category" className="mt-3">
      <div className="grid w-full gap-3 sm:grid-cols-2">
        {!category ? (
          <Field label="Key (lowercase, underscores)" htmlFor={`sc-key-${p}`}>
            <Input id={`sc-key-${p}`} name="key" placeholder="e.g. brand_ambassador_onsite" />
          </Field>
        ) : null}
        <Field label="Label" htmlFor={`sc-label-${p}`}>
          <Input id={`sc-label-${p}`} name="label" defaultValue={category?.label ?? ""} />
        </Field>
        <Field label="Tax follows" htmlFor={`sc-rule-${p}`}>
          <NativeSelect id={`sc-rule-${p}`} name="placeOfSupplyRule" defaultValue={category?.placeOfSupplyRule ?? "finance_review"}>
            <option value="event_province">The event province (qualifying onsite services)</option>
            <option value="finance_review">Always Finance review</option>
          </NativeSelect>
        </Field>
        <Field label="Description" htmlFor={`sc-desc-${p}`} className="sm:col-span-2">
          <Input id={`sc-desc-${p}`} name="description" defaultValue={category?.description ?? ""} />
        </Field>
      </div>
    </ActionForm>
  );
}
