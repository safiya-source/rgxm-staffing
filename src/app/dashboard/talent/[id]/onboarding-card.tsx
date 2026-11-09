// Contractor onboarding & compliance on the talent profile: contractor-process approval, what
// blocks booking, acceptance history, optional consents, status evidence and GST/HST verification.
import { format } from "date-fns";
import { ActionForm } from "@/components/app/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { CONTRACTOR_EVIDENCE_KINDS } from "@/server/db/schema";
import { EVIDENCE_LABEL, LEGAL_KIND_LABEL, onboardingSummary, type LegalKind } from "@/server/domain/onboarding";
import { addEvidenceAction, approveContractorAction, removeEvidenceAction, revokeContractorApprovalAction, verifyGstAction } from "../actions";

const METHOD_LABEL: Record<string, string> = { portal_onboarding: "at sign-up", portal_update: "in the portal", recorded_by_rgxm: "recorded by RGXM" };
const GST_ANSWER: Record<string, string> = { yes: "Yes, registered", no: "No, not registered", unsure: "Unsure", unknown: "Not answered yet" };
const day = (d: Date | string) => format(typeof d === "string" ? new Date(d) : d, "MMM d, yyyy");

export type GstInfo = { status: "yes" | "no" | "unsure" | "unknown"; verification: "unverified" | "verified" | "rejected"; verifiedAt: string | null; reference: string | null; number: string | null; effectiveDate: string | null };

export async function OnboardingCard({ staffId, canApprove, gst, canVerifyGst }: { staffId: string; canApprove: boolean; gst: GstInfo | null; canVerifyGst: boolean }) {
  const s = await onboardingSummary(staffId);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Onboarding & compliance</CardTitle>
        <CardDescription>Each record is kept separately with its history.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 text-sm">
        <section className="grid gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">Contractor-process approval</h3>
          {s.currentApproval ? (
            <p>
              <Badge tone="success">Approved</Badge> {day(s.currentApproval.approvedOn)}
              {s.currentApproval.assessmentReference ? <span className="block text-xs text-muted-foreground">Assessment: {s.currentApproval.assessmentReference}</span> : null}
              {s.currentApproval.notes ? <span className="block text-xs text-muted-foreground">{s.currentApproval.notes}</span> : null}
            </p>
          ) : (
            <p>
              <Badge tone="warning">Not approved</Badge>
            </p>
          )}
          {s.approvals.filter((a) => a.revokedAt).map((a) => (
            <p key={a.id} className="text-xs text-muted-foreground">
              Approved {day(a.approvedOn)}, revoked {day(a.revokedAt!)}: {a.revokeReason}
            </p>
          ))}
          {canApprove && !s.currentApproval ? (
            <ActionForm action={approveContractorAction} hidden={{ staffId }} submitLabel="Record approval" className="grid gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="approvedOn">Approved on</Label>
                <Input id="approvedOn" name="approvedOn" type="date" defaultValue={today} max={today} required />
              </div>
              <Input name="assessmentReference" placeholder="External assessment reference (optional)" />
              <Input name="notes" placeholder="Notes (optional)" />
            </ActionForm>
          ) : null}
          {canApprove && s.currentApproval ? (
            <ActionForm action={revokeContractorApprovalAction} hidden={{ staffId }} submitLabel="Revoke" variant="outline">
              <Input name="reason" placeholder="Reason for revoking" className="h-8 min-w-0 flex-1" required />
            </ActionForm>
          ) : null}
        </section>

        <section className="grid gap-1">
          <h3 className="text-xs font-medium text-muted-foreground">Can they be booked?</h3>
          {s.blockers.length ? (
            <ul className="list-disc pl-5 text-warning">
              {s.blockers.map((b) => (
                <li key={b}>Not yet: {b}</li>
              ))}
            </ul>
          ) : (
            <p className="text-success">Ready to be confirmed for shifts.</p>
          )}
        </section>

        <section className="grid gap-1">
          <h3 className="text-xs font-medium text-muted-foreground">Privacy notice & terms</h3>
          {s.acceptances.length ? (
            <ul className="grid gap-1">
              {s.acceptances.map((a) => (
                <li key={a.id}>
                  {LEGAL_KIND_LABEL[a.kind as LegalKind] ?? a.kind} v{a.version} · {day(a.acceptedAt)} {METHOD_LABEL[a.method] ?? a.method}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No recorded acceptance of an approved version yet.</p>
          )}
        </section>

        <section className="grid gap-1">
          <h3 className="text-xs font-medium text-muted-foreground">Optional consents</h3>
          {s.consents.length ? (
            <ul className="grid gap-1">
              {s.consents.map((c) => (
                <li key={c.key}>
                  {c.label}: {c.granted === null ? (c.offered ? "not answered" : "not offered yet") : c.granted ? "yes" : "no"}
                  {c.at ? <span className="text-muted-foreground"> · {day(c.at)}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">None configured.</p>
          )}
        </section>

        {gst ? (
          <section className="grid gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">GST/HST registration</h3>
            <p>
              {GST_ANSWER[gst.status]}
              {gst.number ? ` · ${gst.number}` : ""}
              {gst.effectiveDate ? ` · effective ${gst.effectiveDate}` : ""}
            </p>
            <p>
              {gst.verification === "verified" ? (
                <Badge tone="success">Verified by Finance</Badge>
              ) : gst.verification === "rejected" ? (
                <Badge tone="danger">Couldn&apos;t be verified</Badge>
              ) : (
                <Badge tone="warning">Not verified: new pay lines go to Finance review</Badge>
              )}
              {gst.verifiedAt ? <span className="block text-xs text-muted-foreground">{day(gst.verifiedAt)} · {gst.reference}</span> : null}
            </p>
            {canVerifyGst && (gst.status === "yes" || gst.status === "no") ? (
              <div className="grid gap-2">
                <ActionForm action={verifyGstAction} hidden={{ staffId, outcome: "verified" }} submitLabel="Verify">
                  <Input name="reference" placeholder="Evidence, e.g. CRA registry lookup 2026-11-09" className="h-8 min-w-0 flex-1" required />
                </ActionForm>
                <ActionForm action={verifyGstAction} hidden={{ staffId, outcome: "rejected" }} submitLabel="Couldn't verify" variant="outline">
                  <Input name="reference" placeholder="What was checked" className="h-8 min-w-0 flex-1" required />
                </ActionForm>
              </div>
            ) : canVerifyGst ? (
              <p className="text-xs text-muted-foreground">Ask the contractor to answer Yes or No in their portal before verifying.</p>
            ) : null}
          </section>
        ) : null}

        <section className="grid gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">Status evidence (optional)</h3>
          {s.evidence.length ? (
            <ul className="grid gap-2">
              {s.evidence.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-2">
                  <span>
                    {EVIDENCE_LABEL[e.kind as keyof typeof EVIDENCE_LABEL] ?? e.kind}
                    {e.reference ? ` · ${e.reference}` : ""}
                    <span className="block text-xs text-muted-foreground">
                      {[e.issuedOn && `issued ${e.issuedOn}`, e.expiresOn && `expires ${e.expiresOn}`, e.verifiedAt ? "verified" : "not verified"].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {canApprove ? <ActionForm action={removeEvidenceAction} hidden={{ staffId, evidenceId: e.id }} submitLabel="Remove" variant="ghost" /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">None on file. Not required for non-construction event work.</p>
          )}
          {canApprove ? (
            <ActionForm action={addEvidenceAction} hidden={{ staffId }} submitLabel="Add evidence" variant="outline" className="grid gap-2">
              <NativeSelect name="kind" aria-label="Kind of evidence">
                {CONTRACTOR_EVIDENCE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {EVIDENCE_LABEL[k]}
                  </option>
                ))}
              </NativeSelect>
              <Input name="reference" placeholder="Reference or certificate number (optional)" />
              <div className="grid grid-cols-2 gap-2">
                <Input name="issuedOn" type="date" aria-label="Issued on" />
                <Input name="expiresOn" type="date" aria-label="Expires on" />
              </div>
              <Label className="flex items-center gap-2 font-normal">
                <Checkbox name="verified" /> I checked the original
              </Label>
            </ActionForm>
          ) : null}
        </section>
      </CardContent>
    </Card>
  );
}
