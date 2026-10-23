"use client";
import { format } from "date-fns";
import { CheckCircle2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { acknowledgeDocumentAction } from "@/app/portal/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export function AcknowledgeButton({ documentId, acknowledgedAt }: { documentId: string; acknowledgedAt: string | null }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [pending, start] = useTransition();
  if (acknowledgedAt) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-success-soft px-4 py-3 text-sm text-success">
        <CheckCircle2Icon className="size-4" /> You confirmed you reviewed this on {format(new Date(acknowledgedAt), "MMM d 'at' h:mm a")}.
      </p>
    );
  }
  return (
    <div className="grid gap-3 rounded-lg border bg-card p-4">
      <label className="flex items-start gap-3 text-[15px]">
        <Checkbox checked={checked} onCheckedChange={(c) => setChecked(Boolean(c))} className="mt-0.5" />
        I&apos;ve read and understood this document.
      </label>
      <Button
        size="lg"
        disabled={!checked || pending}
        onClick={() =>
          start(async () => {
            const res = await acknowledgeDocumentAction(documentId);
            if (res.ok) toast.success(res.message ?? "Thanks");
            else toast.error(res.error);
            router.refresh();
          })
        }
      >
        Confirm
      </Button>
    </div>
  );
}
