import { ArrowLeftIcon, DownloadIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/app/action-form";
import { Field } from "@/components/app/form";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatInZone } from "@/lib/format";
import { getPrivacyRequest, REVIEW_ITEM_LABEL, REVIEW_ITEMS } from "@/server/domain/privacy-ops";
import { requireInternal } from "@/server/session";
import { buildPackageAction, extendDeadlineAction, redactionNotesAction, respondAction, reviewItemAction, verifyIdentityAction } from "../actions";
import { KIND_LABEL, STATUS_LABEL } from "../labels";

export const metadata: Metadata = { title: "Privacy request" };

const day = (d: Date | string | null | undefined) => (d ? formatInZone(d, "America/Toronto", "MMM d, yyyy") : "—");
const UUID = /^[0-9a-f-]{36}$/i;

export default async function PrivacyRequestPage({ params }: PageProps<"/dashboard/privacy/[id]">) {
  await requireInternal("privacy.manage");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const row = await getPrivacyRequest(id);
  if (!row) notFound();
  const { r, staffName } = row;
  const open = ["received", "verifying", "in_review"].includes(r.status);
  const checklist = r.reviewChecklist as Record<string, { reviewed?: boolean; note?: string | null }>;
  const reviewed = REVIEW_ITEMS.filter((i) => checklist[i]?.reviewed).length;
  const due = r.extendedDueAt ?? r.dueAt;
  const hidden = { requestId: r.id };

  return (
    <>
      <Link href="/dashboard/privacy" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Privacy requests
      </Link>
      <PageHeader
        title={`${r.reference} · ${KIND_LABEL[r.kind] ?? r.kind} request`}
        description={
          <>
            From {r.requesterName}
            {r.requesterContact ? ` (${r.requesterContact})` : ""} · received {day(r.receivedAt)}
            {r.receivedVia ? ` by ${r.receivedVia}` : ""}
          </>
        }
        actions={<Badge tone={open ? "info" : "neutral"}>{STATUS_LABEL[r.status] ?? r.status}</Badge>}
      />
      <div className="grid max-w-4xl gap-6">
        <Card>
          <CardContent className="grid gap-2 pt-6 text-sm">
            <p>
              Contractor profile:{" "}
              {r.staffId ? (
                <Link href={`/dashboard/talent/${r.staffId}`} className="font-medium underline">
                  {staffName ?? "Open profile"}
                </Link>
              ) : (
                <span className="text-muted-foreground">Not linked</span>
              )}
            </p>
            <p>
              Due:{" "}
              {due ? (
                <>
                  {day(due)}
                  {r.extendedDueAt ? ` (extended: ${r.extensionReason})` : ""}
                </>
              ) : (
                <span className="text-muted-foreground">No deadline set — set RGXM&apos;s response period in Settings → Contractors &amp; legal.</span>
              )}
            </p>
            {r.details ? <p className="whitespace-pre-wrap text-muted-foreground">{r.details}</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>1. Verify identity</CardTitle>
            <CardDescription>Confirm the requester is the person (or is authorised for them) before sharing or changing anything. Describe how; don&apos;t record ID numbers.</CardDescription>
          </CardHeader>
          <CardContent>
            {r.identityVerifiedAt ? (
              <p className="text-sm">
                <Badge tone="success">Verified {day(r.identityVerifiedAt)}</Badge> <span className="text-muted-foreground">{r.identityMethod}</span>
              </p>
            ) : open ? (
              <ActionForm action={verifyIdentityAction} hidden={hidden} submitLabel="Record verification">
                <Input name="method" aria-label="How identity was verified" placeholder="e.g. Replied from the email on file and confirmed two recent shifts" className="w-full sm:w-[28rem]" required />
              </ActionForm>
            ) : (
              <p className="text-sm text-muted-foreground">Not verified.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Review every section</CardTitle>
            <CardDescription>
              Include internal notes, evaluations, messages, files and logs in the review. Redact other people&apos;s information or anything withheld under an exception your
              lawyer confirmed. {reviewed} of {REVIEW_ITEMS.length} reviewed.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {REVIEW_ITEMS.map((item) => {
              const c = checklist[item];
              return (
                <div key={item} className="grid gap-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{REVIEW_ITEM_LABEL[item]}</span>
                    {c?.reviewed ? <Badge tone="success">Reviewed</Badge> : <Badge tone="warning">Not reviewed</Badge>}
                  </div>
                  {c?.note ? <p className="text-sm text-muted-foreground">{c.note}</p> : null}
                  {open ? (
                    <ActionForm action={reviewItemAction} hidden={{ ...hidden, item, reviewed: c?.reviewed ? "false" : "true" }} submitLabel={c?.reviewed ? "Mark not reviewed" : "Mark reviewed"} variant="outline">
                      <Input name="note" aria-label="Note" placeholder="Note (e.g. redacted another contractor's name)" defaultValue={c?.note ?? ""} className="w-full sm:w-96" />
                    </ActionForm>
                  ) : null}
                </div>
              );
            })}
            {open ? (
              <ActionForm action={redactionNotesAction} hidden={hidden} submitLabel="Save redaction notes" variant="outline" keep>
                <Field label="Redaction notes" htmlFor="redaction" className="w-full">
                  <Textarea id="redaction" name="redactionNotes" defaultValue={r.redactionNotes ?? ""} />
                </Field>
              </ActionForm>
            ) : r.redactionNotes ? (
              <p className="text-sm text-muted-foreground">Redaction notes: {r.redactionNotes}</p>
            ) : null}
          </CardContent>
        </Card>

        {r.kind === "access" ? (
          <Card>
            <CardHeader>
              <CardTitle>3. Access package</CardTitle>
              <CardDescription>
                A private file with the person&apos;s record plus the notes, evaluations, file list and log entries to review. It&apos;s never emailed: release a reviewed copy
                securely (e.g. an expiring download link or in person).
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              {open ? <ActionForm action={buildPackageAction} hidden={hidden} submitLabel={r.responseStorageKey ? "Regenerate package" : "Generate package"} variant="outline" /> : null}
              {r.responseStorageKey ? (
                <Button asChild variant="outline" size="sm">
                  <a href={`/api/privacy/requests/${r.id}/package`}>
                    <DownloadIcon /> Download for review
                  </a>
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {open ? (
          <Card>
            <CardHeader>
              <CardTitle>Extend the deadline</CardTitle>
              <CardDescription>Only where RGXM&apos;s lawyer says an extension is allowed, and after telling the requester.</CardDescription>
            </CardHeader>
            <CardContent>
              <ActionForm action={extendDeadlineAction} hidden={hidden} submitLabel="Record extension">
                <Input name="newDueOn" type="date" aria-label="New due date" className="w-44" required />
                <Input name="reason" aria-label="Reason" placeholder="Reason, and when the requester was told" className="w-full sm:w-96" required />
              </ActionForm>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>{r.kind === "access" ? "4. Respond" : "3. Respond"}</CardTitle>
            <CardDescription>
              {r.kind === "deletion"
                ? "Responding to a deletion request erases the person's personal details now (unless a legal hold applies). Work, pay, tax and bill records, and messages exchanged with RGXM, are kept as required; the audit log keeps only that the erasure happened."
                : r.kind === "correction"
                  ? "Make the corrections on the contractor's profile first, then record what was changed."
                  : "Release the reviewed package securely, then record how it was sent."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {open ? (
              <ActionForm action={respondAction} hidden={hidden} submitLabel="Record response and close" confirm={r.kind === "deletion" ? "This erases the person's personal details now. Continue?" : undefined}>
                <div className="grid w-full gap-3 sm:grid-cols-2">
                  <Field label="Outcome" htmlFor="resp-outcome">
                    <NativeSelect id="resp-outcome" name="outcome" defaultValue="responded">
                      <option value="responded">{r.kind === "deletion" ? "Completed (erase now)" : "Completed"}</option>
                      <option value="refused">Refused (with reasons)</option>
                      <option value="withdrawn">Withdrawn by requester</option>
                    </NativeSelect>
                  </Field>
                  <Field label="How the response was sent" htmlFor="resp-method">
                    <Input id="resp-method" name="method" placeholder="e.g. Secure link, expired after 7 days" />
                  </Field>
                  <Field label="Summary" htmlFor="resp-summary" className="sm:col-span-2">
                    <Textarea id="resp-summary" name="summary" />
                  </Field>
                </div>
              </ActionForm>
            ) : (
              <p className="text-sm">
                {STATUS_LABEL[r.status]} {day(r.respondedAt)} · {r.responseMethod ?? "—"}
                <span className="block text-muted-foreground">{r.responseSummary}</span>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
