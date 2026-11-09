"use client";
import { useState } from "react";
import { ActionForm, useRunAction } from "@/components/app/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { EXPORT_FORMAT_LABEL, EXPORT_FORMATS } from "@/server/domain/payment-exports";
import {
  approveBatchAction,
  exportBatchAction,
  markPaidAction,
  markSubmittedAction,
  recordReturnAction,
  recordSettlementAction,
  removeFromBatchAction,
  supersedeExportAction,
  voidBatchAction,
} from "../../actions";

/** Starts a file download from an API route without leaving the page. */
function download(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = "";
  a.click();
}

const today = () => new Date().toISOString().slice(0, 10);

export const ATTEMPT_LABEL: Record<string, [string, "neutral" | "success" | "warning" | "info" | "danger" | "brand" | "outline"]> = {
  included: ["In batch", "info"],
  exported: ["In bank file", "brand"],
  submitted: ["Sent to bank", "brand"],
  settled: ["Settled", "success"],
  failed: ["Failed", "danger"],
  returned: ["Returned by bank", "danger"],
  bank_cancelled: ["Cancelled by bank", "danger"],
  removed: ["Removed", "outline"],
  voided: ["Voided in Crew", "outline"],
};

export function AttemptBadge({ state }: { state: string }) {
  const [label, tone] = ATTEMPT_LABEL[state] ?? [state, "neutral"];
  return <Badge tone={tone}>{label}</Badge>;
}

type BatchInfo = { id: string; status: string; type: "contractor" | "payroll"; isOwn: boolean; hasLiveExport: boolean; submitted: boolean };

export function BatchActions({ batch: b, items }: { batch: BatchInfo; items: { payableId: string; label: string; state: string }[] }) {
  const { pending, run, stepUpDialog } = useRunAction();
  const [format, setFormat] = useState<string>("csv_generic");
  const [paidOn, setPaidOn] = useState(today);
  const [evidence, setEvidence] = useState("");
  const [bankRef, setBankRef] = useState("");
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [voidReason, setVoidReason] = useState("");
  const [remove, setRemove] = useState({ payableId: "", reason: "" });
  const outstanding = items.filter((i) => i.state === "exported" || i.state === "submitted");

  if (b.status === "paid" || b.status === "void") return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Next step</CardTitle>
        <CardDescription>Crew never moves money. Exporting a bank file doesn&apos;t mark anything as paid: record what the bank did once it confirms.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {stepUpDialog}
        {b.status === "draft" ? (
          b.isOwn ? (
            <p className="text-sm text-muted-foreground">Waiting for a second person in Finance or an admin to approve this batch. You created it, so you can&apos;t approve it.</p>
          ) : (
            <ConfirmButton
              title="Approve this batch?"
              description="You're confirming the people, amounts and payment details are correct. If any of these change before export, your approval is cancelled automatically."
              onConfirm={() => run(() => approveBatchAction(b.id))}
              disabled={pending}
            >
              Approve batch
            </ConfirmButton>
          )
        ) : null}

        {b.status === "approved" || (b.status === "exported" && !b.hasLiveExport && !b.submitted) ? (
          <div className="grid gap-2">
            <Label htmlFor="format">Bank file format</Label>
            <NativeSelect id="format" value={format} onChange={(e) => setFormat(e.target.value)}>
              {EXPORT_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {EXPORT_FORMAT_LABEL[f]}
                </option>
              ))}
            </NativeSelect>
            <Button disabled={pending} onClick={() => run(() => exportBatchAction(b.id, format), (r) => r.ok && r.data && download(`/api/payments/exports/${r.data.exportId}`))}>
              Generate bank file
            </Button>
            <p className="text-xs text-muted-foreground">
              The first export finalizes a bill for each contractor. QuickBooks bills are exported separately under Payments → Accounting exports. One live bank file per batch, so the same payments can&apos;t be sent twice.
            </p>
          </div>
        ) : null}

        {b.status === "exported" && b.hasLiveExport && !b.submitted ? (
          <div className="grid gap-2 border-t pt-4">
            <p className="text-sm font-medium">Record the bank submission</p>
            <ActionForm action={markSubmittedAction} hidden={{ batchId: b.id }} submitLabel="Record submission" className="grid">
              <Input name="submittedOn" type="date" defaultValue={today()} aria-label="Submitted on" required />
              <Input name="bankReference" placeholder="Bank's reference for the upload" aria-label="Bank reference" required />
            </ActionForm>
            <p className="text-xs text-muted-foreground">Still not paid: this only notes that the file went to the bank.</p>
          </div>
        ) : null}

        {b.status === "exported" && outstanding.length ? (
          <div className="grid gap-3 border-t pt-4">
            <p className="text-sm font-medium">Bank confirmed all remaining payments?</p>
            <div className="grid gap-1.5">
              <Label htmlFor="paid-on">Settlement date</Label>
              <Input id="paid-on" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="evidence">Bank evidence</Label>
              <Input id="evidence" placeholder="e.g. Statement Nov 2026, lines 12–18" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
            </div>
            <Input aria-label="Bank reference (optional)" placeholder="Bank reference (optional)" value={bankRef} onChange={(e) => setBankRef(e.target.value)} />
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm">Any that failed?</legend>
              {outstanding.map((i) => (
                <div key={i.payableId} className="grid gap-1">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={i.payableId in failed}
                      onCheckedChange={(on) =>
                        setFailed((f) => {
                          const n = { ...f };
                          if (on) n[i.payableId] = "";
                          else delete n[i.payableId];
                          return n;
                        })
                      }
                    />
                    {i.label}
                  </label>
                  {i.payableId in failed ? (
                    <Input aria-label={`Why ${i.label} failed`} placeholder="Reason, e.g. account closed" value={failed[i.payableId]} onChange={(e) => setFailed((f) => ({ ...f, [i.payableId]: e.target.value }))} />
                  ) : null}
                </div>
              ))}
            </fieldset>
            <ConfirmButton
              title="Record these payments as settled?"
              description="Only once the bank has confirmed them. Contractors will see them as paid and get a notification."
              confirmLabel="Record settlement"
              onConfirm={() => run(() => markPaidAction(b.id, { paidOn, evidence, bankReference: bankRef, failed: Object.entries(failed).map(([payableId, reason]) => ({ payableId, reason })) }))}
              disabled={pending || !evidence.trim()}
            >
              Record settlement
            </ConfirmButton>
            <p className="text-xs text-muted-foreground">To record lines one by one (settled, failed or cancelled by the bank), use the form on each line.</p>
          </div>
        ) : null}

        {(b.status === "draft" || b.status === "approved") && items.length > 1 ? (
          <div className="grid gap-2 border-t pt-4">
            <Label htmlFor="remove-item">Remove an item</Label>
            <NativeSelect id="remove-item" value={remove.payableId} onChange={(e) => setRemove({ ...remove, payableId: e.target.value })}>
              <option value="">Choose…</option>
              {items.map((i) => (
                <option key={i.payableId} value={i.payableId}>
                  {i.label}
                </option>
              ))}
            </NativeSelect>
            <Input aria-label="Reason for removing" placeholder="Reason" value={remove.reason} onChange={(e) => setRemove({ ...remove, reason: e.target.value })} />
            {b.status === "approved" ? <p className="text-xs text-warning">Removing an item cancels the approval; a second person must approve again.</p> : null}
            <Button variant="outline" disabled={pending || !remove.payableId || !remove.reason.trim()} onClick={() => run(() => removeFromBatchAction(b.id, remove.payableId, remove.reason), () => setRemove({ payableId: "", reason: "" }))}>
              Remove from batch
            </Button>
          </div>
        ) : null}

        {!b.submitted ? (
          <div className="grid gap-2 border-t pt-4">
            <Label htmlFor="void-reason">Void in Crew</Label>
            <Textarea id="void-reason" rows={2} placeholder="Why? e.g. built with the wrong period; file never sent to the bank" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
            <ConfirmButton
              variant="outline"
              destructive
              title="Void this batch in Crew?"
              description={b.status === "exported" ? "Only if the bank file was NOT sent to the bank. Items return to ready-to-pay (billed lines keep their bill) and could be paid again." : "Items return to the ready-to-pay list."}
              confirmLabel="Void batch"
              disabled={pending || !voidReason.trim()}
              onConfirm={() => run(() => voidBatchAction(b.id, voidReason))}
            >
              Void batch
            </ConfirmButton>
          </div>
        ) : (
          <p className="border-t pt-4 text-xs text-muted-foreground">
            This file was submitted to the bank, so the batch can&apos;t be voided in Crew. If the bank cancels a payment, record &ldquo;Cancelled by bank&rdquo; with its reference on that line.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Per-line reconciliation (settled / failed / cancelled by bank) or a return after settlement. */
export function LineReconcile({ batchId, payableId, state }: { batchId: string; payableId: string; state: string }) {
  const [outcome, setOutcome] = useState("settled");
  const [open, setOpen] = useState(false);
  if (state !== "exported" && state !== "submitted" && state !== "settled") return null;
  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {state === "settled" ? "Record return" : "Record outcome"}
      </Button>
    );
  }
  if (state === "settled") {
    return (
      <ActionForm action={recordReturnAction} hidden={{ batchId, payableId }} submitLabel="Record return" className="grid min-w-56">
        <Input name="returnedOn" type="date" defaultValue={today()} aria-label="Returned on" required />
        <Input name="reason" placeholder="Reason, e.g. account closed" aria-label="Return reason" required />
        <Input name="bankReference" placeholder="Bank's return reference" aria-label="Bank reference" required />
      </ActionForm>
    );
  }
  return (
    <ActionForm action={recordSettlementAction} hidden={{ batchId, payableId, outcome }} submitLabel="Save" className="grid min-w-56">
      <NativeSelect value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome">
        <option value="settled">Settled (bank confirmed)</option>
        <option value="failed">Failed</option>
        <option value="bank_cancelled">Cancelled by the bank</option>
      </NativeSelect>
      <Input name="date" type="date" defaultValue={today()} aria-label="Date" required />
      {outcome === "settled" ? <Input name="evidence" placeholder="Bank evidence (statement line…)" aria-label="Evidence" required /> : <Input name="reason" placeholder="Reason" aria-label="Reason" required />}
      <Input name="bankReference" placeholder={outcome === "bank_cancelled" ? "Bank's cancellation reference" : "Bank reference (optional)"} aria-label="Bank reference" required={outcome === "bank_cancelled"} />
    </ActionForm>
  );
}

export function SupersedeExport({ batchId, exportId, canVoid }: { batchId: string; exportId: string; canVoid: boolean }) {
  const { pending, run } = useRunAction();
  const [reason, setReason] = useState("");
  if (!canVoid) return null;
  return (
    <div className="grid gap-2 border-t pt-3">
      <Label htmlFor="supersede">Need a new file?</Label>
      <Input id="supersede" placeholder="Why the current file isn't being used" value={reason} onChange={(e) => setReason(e.target.value)} />
      <ConfirmButton
        variant="outline"
        size="sm"
        title="Void the current bank file?"
        description="Confirm the current file was not sent to the bank. You can then generate a replacement."
        confirmLabel="Void file"
        disabled={pending || !reason.trim()}
        onConfirm={() => run(() => supersedeExportAction(batchId, exportId, reason), () => setReason(""))}
      >
        Void file
      </ConfirmButton>
    </div>
  );
}
