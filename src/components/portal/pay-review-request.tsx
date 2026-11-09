"use client";
import { useState } from "react";
import { requestPayReviewAction } from "@/app/portal/actions";
import { ActionForm } from "@/components/app/action-form";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

/** A contractor asks RGXM Finance to review a payment line (or pay in general). */
export function PayReviewRequest({ payableId, billId, label, kind, showKinds = false }: { payableId: string | null; billId?: string; label: string; kind: "tax" | "amount" | "hours" | "other"; showKinds?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="cursor-pointer text-left text-xs font-medium text-foreground underline underline-offset-2" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return (
    <ActionForm action={requestPayReviewAction} hidden={{ payableId: payableId ?? "", billId: billId ?? "", ...(showKinds ? {} : { kind }) }} submitLabel="Send to RGXM Finance" className="grid w-full gap-2">
      {showKinds ? (
        <NativeSelect name="kind" defaultValue="other" aria-label="What's it about?">
          <option value="tax">Tax or GST/HST</option>
          <option value="amount">Amount or rate</option>
          <option value="hours">Hours</option>
          <option value="other">Something else</option>
        </NativeSelect>
      ) : null}
      <Textarea name="message" rows={3} required placeholder={kind === "tax" ? "e.g. I'm registered for GST/HST since March; my number is on my profile." : "Tell us what looks wrong"} />
    </ActionForm>
  );
}
