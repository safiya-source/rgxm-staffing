"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { EXPORT_FORMAT_LABEL, EXPORT_FORMATS } from "@/server/domain/payment-exports";
import { approveBatchAction, exportBatchAction, markPaidAction, removeFromBatchAction, supersedeExportAction, voidBatchAction } from "../../actions";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = <T,>(fn: () => Promise<ActionResult<T>>, after?: (r: ActionResult<T>) => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message ?? "Done");
        after?.(res);
        router.refresh();
      } else toast.error(res.error);
    });
  return { pending, run };
}

/** Starts a file download from an API route without leaving the page. */
function download(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = "";
  a.click();
}

type BatchInfo = { id: string; status: string; type: "contractor" | "payroll"; isOwn: boolean; hasLiveExport: boolean };

export function BatchActions({ batch: b, items }: { batch: BatchInfo; items: { payableId: string; label: string }[] }) {
  const { pending, run } = useRun();
  const [format, setFormat] = useState<string>("csv_generic");
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [voidReason, setVoidReason] = useState("");
  const [remove, setRemove] = useState({ payableId: "", reason: "" });
  const formats = EXPORT_FORMATS.filter((f) => f !== "csv_qbo" || b.type === "contractor");

  if (b.status === "paid" || b.status === "void") return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Next step</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        {b.status === "draft" ? (
          b.isOwn ? (
            <p className="text-sm text-muted-foreground">Waiting for a second person in Finance or an admin to approve this batch. You created it, so you can&apos;t approve it.</p>
          ) : (
            <ConfirmButton title="Approve this batch?" description="You're confirming the people, hours and amounts are correct. It can then be exported for payment." onConfirm={() => run(() => approveBatchAction(b.id))} disabled={pending}>
              Approve batch
            </ConfirmButton>
          )
        ) : null}

        {b.status === "approved" || (b.status === "exported" && !b.hasLiveExport) ? (
          <div className="grid gap-2">
            <Label htmlFor="format">Export format</Label>
            <NativeSelect id="format" value={format} onChange={(e) => setFormat(e.target.value)}>
              {formats.map((f) => (
                <option key={f} value={f}>
                  {EXPORT_FORMAT_LABEL[f]}
                </option>
              ))}
            </NativeSelect>
            <Button
              disabled={pending}
              onClick={() => run(() => exportBatchAction(b.id, format), (r) => r.ok && r.data && download(`/api/payments/exports/${r.data.exportId}`))}
            >
              Generate export
            </Button>
            <p className="text-xs text-muted-foreground">One live export per batch, so the same payments can&apos;t be imported twice.</p>
          </div>
        ) : null}

        {b.status === "exported" && b.hasLiveExport ? (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="paid-on">Paid on</Label>
              <Input id="paid-on" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Any payments that failed?</legend>
              {items.map((i) => (
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
              title="Mark this batch as paid?"
              description="Record this only once the payment has actually been sent. Staff will see it as paid and get a notification."
              confirmLabel="Mark paid"
              onConfirm={() => run(() => markPaidAction(b.id, { paidOn, failed: Object.entries(failed).map(([payableId, reason]) => ({ payableId, reason })) }))}
              disabled={pending}
            >
              Mark paid
            </ConfirmButton>
          </div>
        ) : null}

        {b.status === "draft" && items.length > 1 ? (
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
            <Button variant="outline" disabled={pending || !remove.payableId || !remove.reason.trim()} onClick={() => run(() => removeFromBatchAction(b.id, remove.payableId, remove.reason), () => setRemove({ payableId: "", reason: "" }))}>
              Remove from batch
            </Button>
          </div>
        ) : null}

        <div className="grid gap-2 border-t pt-4">
          <Label htmlFor="void-reason">Void batch</Label>
          <Textarea id="void-reason" rows={2} placeholder="Why? e.g. built with the wrong period; file never imported" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
          <ConfirmButton
            variant="outline"
            destructive
            title="Void this batch?"
            description={b.status === "exported" ? "Only do this if the exported file was NOT used to pay anyone. Items return to ready-to-pay and could be paid again." : "Items return to the ready-to-pay list."}
            confirmLabel="Void batch"
            disabled={pending || !voidReason.trim()}
            onConfirm={() => run(() => voidBatchAction(b.id, voidReason))}
          >
            Void batch
          </ConfirmButton>
        </div>
      </CardContent>
    </Card>
  );
}

export function SupersedeExport({ batchId, exportId, canVoid }: { batchId: string; exportId: string; canVoid: boolean }) {
  const { pending, run } = useRun();
  const [reason, setReason] = useState("");
  if (!canVoid) return null;
  return (
    <div className="grid gap-2 border-t pt-3">
      <Label htmlFor="supersede">Need a new file?</Label>
      <Input id="supersede" placeholder="Why the current file isn't being used" value={reason} onChange={(e) => setReason(e.target.value)} />
      <ConfirmButton
        variant="outline"
        size="sm"
        title="Void the current export?"
        description="Confirm the current file was not imported or used to pay anyone. You can then generate a replacement."
        confirmLabel="Void export"
        disabled={pending || !reason.trim()}
        onConfirm={() => run(() => supersedeExportAction(batchId, exportId, reason), () => setReason(""))}
      >
        Void export
      </ConfirmButton>
    </div>
  );
}
