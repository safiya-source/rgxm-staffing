import type { Metadata } from "next";
import { ActionForm } from "@/components/app/action-form";
import { Field } from "@/components/app/form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatInZone } from "@/lib/format";
import { LEGAL_KIND_LABEL, listConsentPurposes, listDocuments, type LegalKind } from "@/server/domain/onboarding";
import { requireInternal } from "@/server/session";
import { getOrgSettings } from "@/server/settings";
import {
  approveDocumentAction,
  deleteDocumentAction,
  saveConsentPurposeAction,
  saveDocumentAction,
  savePaymentTermsAction,
  savePrivacyOfficerAction,
  saveRequirementsAction,
  saveResponsePeriodAction,
  setConsentPurposeAction,
} from "./actions";

export const metadata: Metadata = { title: "Contractors & legal" };

const day = (d: Date | string | null | undefined) => (d ? formatInZone(d, "America/Toronto", "MMM d, yyyy") : "—");

export default async function CompliancePage() {
  await requireInternal("legal.manage");
  const [settings, documents, purposes] = await Promise.all([getOrgSettings(), listDocuments(), listConsentPurposes()]);
  const terms = settings.paymentTerms ?? {};
  const kinds: LegalKind[] = ["privacy_notice", "contractor_terms", "platform_terms"];

  return (
    <div className="grid max-w-4xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Privacy Officer and contacts</CardTitle>
          <CardDescription>Shown on the Privacy Policy, Terms and Contractor Agreement pages and in the staff portal.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={savePrivacyOfficerAction} submitLabel="Save contact" keep>
            <div className="grid w-full gap-4 sm:grid-cols-3">
              <Field label="Name or title" htmlFor="po-name">
                <Input id="po-name" name="name" defaultValue={settings.privacyOfficerName ?? ""} placeholder="e.g. Privacy Officer, RGXM" />
              </Field>
              <Field label="Email" htmlFor="po-email">
                <Input id="po-email" name="email" type="email" defaultValue={settings.privacyOfficerEmail ?? ""} />
              </Field>
              <Field label="Phone (optional)" htmlFor="po-phone">
                <Input id="po-phone" name="phone" defaultValue={settings.privacyOfficerPhone ?? ""} />
              </Field>
              <Field label="Mailing address" htmlFor="po-address" className="sm:col-span-3">
                <Input id="po-address" name="address" defaultValue={settings.privacyOfficerAddress ?? ""} />
              </Field>
              <Field label="Platform support and account closure email" htmlFor="po-support">
                <Input id="po-support" name="supportEmail" type="email" defaultValue={settings.supportEmail ?? ""} />
              </Field>
              <Field label="Finance and payments email" htmlFor="po-finance">
                <Input id="po-finance" name="financeEmail" type="email" defaultValue={settings.financeEmail ?? ""} />
              </Field>
            </div>
          </ActionForm>
          {!settings.privacyOfficerEmail ? <p className="mt-3 text-sm text-warning">No Privacy Officer contact is set yet.</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Requirements</CardTitle>
          <CardDescription>These switches change who can be booked and who can sign in. Think before turning them off.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={saveRequirementsAction} submitLabel="Save requirements" keep>
            <div className="grid w-full gap-4">
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" name="requireContractorApproval" defaultChecked={settings.requireContractorApproval} className="mt-1 size-4" />
                <span>
                  <span className="font-medium">Require RGXM&apos;s contractor approval before a booking can be confirmed</span>
                  <span className="block text-muted-foreground">
                    Approval is recorded automatically when a contractor accepts the Independent Contractor Agreement. You can also record it on their talent profile
                    (or in bulk from the Talent list), and revoke it there; a revoked person stays blocked until RGXM approves them again. Turning this off lets anyone be
                    confirmed without a recorded approval.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" name="requireMfaForStaff" defaultChecked={settings.requireMfaForStaff} className="mt-1 size-4" />
                <span>
                  <span className="font-medium">Require two-step verification for all RGXM staff accounts</span>
                  <span className="block text-muted-foreground">
                    Staff without an authenticator app are sent to set one up before they can do anything else. Contractors aren&apos;t affected. Turning this off weakens
                    account security; Admins and Finance still need it while the Organisation setting is on.
                  </span>
                </span>
              </label>
            </div>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Privacy notice and contractor terms</CardTitle>
          <CardDescription>
            Paste the text your lawyer approved. Publishing a version makes it current: every contractor must accept it (in the staff portal) before they can be confirmed for
            new bookings. Published versions can&apos;t be edited; publish a new version instead.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {kinds.map((kind) => {
            const docs = documents.filter((d) => d.kind === kind);
            return (
              <section key={kind} className="grid gap-3">
                <h4 className="font-medium">{LEGAL_KIND_LABEL[kind]}</h4>
                {docs.length === 0 ? <p className="text-sm text-muted-foreground">No versions yet.</p> : null}
                {docs.map((d) => (
                  <div key={d.id} className="grid gap-3 rounded-lg border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {d.title} · v{d.version}
                      </span>
                      <Badge tone={d.status === "approved" ? "success" : d.status === "draft" ? "warning" : "neutral"}>{d.status === "approved" ? "Current" : d.status === "draft" ? "Draft" : "Retired"}</Badge>
                      {d.selfBilling ? <Badge tone="info">Includes self-billing</Badge> : null}
                    </div>
                    {d.status !== "draft" ? (
                      <p className="text-sm text-muted-foreground">
                        Published {day(d.approvedAt)} · Legal review: {d.approvalReference ?? "—"}
                      </p>
                    ) : (
                      <>
                        <details>
                          <summary className="cursor-pointer text-sm text-muted-foreground">Edit draft</summary>
                          <DocumentForm doc={d} />
                        </details>
                        <div className="flex flex-wrap gap-3">
                          <ActionForm action={approveDocumentAction} hidden={{ documentId: d.id }} submitLabel="Publish this version">
                            <Input name="reference" aria-label="Legal review reference" placeholder="Reviewed by (firm/person) and date" className="w-72" required />
                          </ActionForm>
                          <ActionForm action={deleteDocumentAction} hidden={{ documentId: d.id }} submitLabel="Delete draft" variant="outline" confirm="Delete this draft?" />
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </section>
            );
          })}
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">Add a new draft</summary>
            <DocumentForm />
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Optional consent choices</CardTitle>
          <CardDescription>
            Choices contractors can opt into (for example, news emails). A choice is only offered once its wording is approved. Changing the wording withdraws approval until
            it&apos;s approved again; earlier answers stay in each person&apos;s history.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {purposes.map((p) => (
            <div key={p.key} className="grid gap-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.label}</span>
                <Badge tone={p.active && p.approvedAt ? "success" : "warning"}>{p.active && p.approvedAt ? "Offered" : "Not offered"}</Badge>
                <span className="text-xs text-muted-foreground">
                  {p.key} · wording v{p.version}
                  {p.approvalReference ? ` · approved: ${p.approvalReference}` : ""}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{p.description}</p>
              <div className="flex flex-wrap gap-3">
                {p.active && p.approvedAt ? (
                  <ActionForm action={setConsentPurposeAction} hidden={{ key: p.key, active: "false", reference: "" }} submitLabel="Stop offering" variant="outline" />
                ) : (
                  <ActionForm action={setConsentPurposeAction} hidden={{ key: p.key, active: "true" }} submitLabel="Approve and offer">
                    <Input name="reference" aria-label="Approval reference" placeholder="Wording approved by (who) and date" className="w-72" required />
                  </ActionForm>
                )}
              </div>
              <details>
                <summary className="cursor-pointer text-sm text-muted-foreground">Edit wording</summary>
                <ActionForm action={saveConsentPurposeAction} hidden={{ key: p.key }} submitLabel="Save wording" className="mt-3">
                  <div className="grid w-full gap-3">
                    <Field label="Label" htmlFor={`cp-label-${p.key}`}>
                      <Input id={`cp-label-${p.key}`} name="label" defaultValue={p.label} />
                    </Field>
                    <Field label="Description shown to contractors" htmlFor={`cp-desc-${p.key}`}>
                      <Textarea id={`cp-desc-${p.key}`} name="description" defaultValue={p.description} />
                    </Field>
                  </div>
                </ActionForm>
              </details>
            </div>
          ))}
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">Add a consent choice</summary>
            <ActionForm action={saveConsentPurposeAction} submitLabel="Save draft wording" className="mt-3">
              <div className="grid w-full gap-3">
                <Field label="Key (lowercase, underscores)" htmlFor="cp-key">
                  <Input id="cp-key" name="key" placeholder="e.g. photo_in_recaps" />
                </Field>
                <Field label="Label" htmlFor="cp-label">
                  <Input id="cp-label" name="label" />
                </Field>
                <Field label="Description shown to contractors" htmlFor="cp-desc">
                  <Textarea id="cp-desc" name="description" />
                </Field>
              </div>
            </ActionForm>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment terms</CardTitle>
          <CardDescription>
            When bills are due and when hours must be approved to make a pay run. Until RGXM approves terms here, every new bill&apos;s due date equals its bill date and is
            marked &ldquo;terms not approved&rdquo;.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-sm">
            Status:{" "}
            {terms.approvedAt ? (
              <Badge tone="success">Approved {day(terms.approvedAt)}</Badge>
            ) : (
              <Badge tone="warning">Not approved</Badge>
            )}
          </p>
          <ActionForm action={savePaymentTermsAction} submitLabel="Save terms" keep>
            <div className="grid w-full gap-4 sm:grid-cols-2">
              <Field label="How due dates are set" htmlFor="pt-rule" className="sm:col-span-2">
                <NativeSelect id="pt-rule" name="dueRule" defaultValue={terms.dueRule ?? "days_after_bill"}>
                  <option value="semi_monthly_agreement">Contractor Agreement §4: work on the 1st–15th due by month end; 16th–end due by the 15th of next month</option>
                  <option value="days_after_bill">A number of days after the bill date</option>
                </NativeSelect>
              </Field>
              <Field label="Cutoff: days after the pay period ends" htmlFor="pt-cutoff" hint="Hours approved after this go into the next pay run.">
                <Input id="pt-cutoff" name="cutoffDaysAfterPeriodEnd" inputMode="numeric" defaultValue={terms.cutoffDaysAfterPeriodEnd ?? ""} />
              </Field>
              <Field label="Bills are due this many days after the bill date (only for that rule)" htmlFor="pt-due">
                <Input id="pt-due" name="dueDaysAfterBillDate" inputMode="numeric" defaultValue={terms.dueDaysAfterBillDate ?? ""} />
              </Field>
              <Field label="Description for contractors" htmlFor="pt-desc" className="sm:col-span-2">
                <Textarea id="pt-desc" name="description" defaultValue={terms.description ?? ""} placeholder="e.g. Paid by e-transfer within 15 days of the end of each pay period." />
              </Field>
              <Field label="Approval reference" htmlFor="pt-ref" className="sm:col-span-2" hint="Who at RGXM approved these terms and when. Leave blank to save without approving.">
                <Input id="pt-ref" name="approvalReference" defaultValue={terms.approvalReference ?? ""} />
              </Field>
            </div>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Privacy request response period</CardTitle>
          <CardDescription>
            How many days RGXM has to respond to access, correction and deletion requests. Crew doesn&apos;t assume a legal deadline: set the period your lawyer advised. Leave blank
            and requests won&apos;t get a due date.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={saveResponsePeriodAction} submitLabel="Save period" keep>
            <Field label="Days to respond" htmlFor="rp-days">
              <Input id="rp-days" name="days" inputMode="numeric" defaultValue={settings.privacyRequestResponseDays ?? ""} className="w-32" />
            </Field>
            <Field label="Decided by (reference)" htmlFor="rp-ref">
              <Input id="rp-ref" name="reference" placeholder="e.g. lawyer's advice of 2026-11-25" className="w-72" />
            </Field>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}

function DocumentForm({ doc }: { doc?: { id: string; kind: string; version: string; title: string; body: string; summaryOfChanges: string | null; selfBilling?: boolean } }) {
  const p = doc?.id ?? "new";
  return (
    <ActionForm action={saveDocumentAction} hidden={doc ? { documentId: doc.id } : undefined} submitLabel={doc ? "Save draft" : "Create draft"} className="mt-3">
      <div className="grid w-full gap-3 sm:grid-cols-3">
        <Field label="Document" htmlFor={`doc-kind-${p}`}>
          <NativeSelect id={`doc-kind-${p}`} name="kind" defaultValue={doc?.kind ?? "privacy_notice"}>
            <option value="privacy_notice">{LEGAL_KIND_LABEL.privacy_notice}</option>
            <option value="contractor_terms">{LEGAL_KIND_LABEL.contractor_terms}</option>
            <option value="platform_terms">{LEGAL_KIND_LABEL.platform_terms}</option>
          </NativeSelect>
        </Field>
        <Field label="Version" htmlFor={`doc-version-${p}`}>
          <Input id={`doc-version-${p}`} name="version" defaultValue={doc?.version ?? ""} placeholder="e.g. 1.0" />
        </Field>
        <Field label="Title" htmlFor={`doc-title-${p}`}>
          <Input id={`doc-title-${p}`} name="title" defaultValue={doc?.title ?? ""} />
        </Field>
        <Field label="Full text" htmlFor={`doc-body-${p}`} className="sm:col-span-3">
          <Textarea id={`doc-body-${p}`} name="body" defaultValue={doc?.body ?? ""} rows={10} />
        </Field>
        <Field label="What changed (optional)" htmlFor={`doc-summary-${p}`} className="sm:col-span-3">
          <Input id={`doc-summary-${p}`} name="summaryOfChanges" defaultValue={doc?.summaryOfChanges ?? ""} />
        </Field>
        <label className="flex items-start gap-2 text-sm sm:col-span-3">
          <input type="checkbox" name="selfBilling" defaultChecked={doc?.selfBilling ?? false} className="mt-0.5 size-4 accent-brand" />
          <span>
            Contractor Agreement only: this version includes the self-billing clause (RGXM prepares invoices on the contractor&apos;s behalf). Contractors who accept it get
            Contractor Invoices issued in Crew.
          </span>
        </label>
      </div>
    </ActionForm>
  );
}
