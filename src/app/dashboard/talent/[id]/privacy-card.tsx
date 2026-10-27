"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Textarea } from "@/components/ui/textarea";
import { anonymizeStaffAction } from "./privacy-actions";

/** Privacy officer tools: access-request export and erasure on request. */
export function PrivacyCard({ staffId, anonymized }: { staffId: string; anonymized: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Privacy requests</CardTitle>
        <CardDescription>For access and deletion requests under PIPEDA. Every action is recorded in the audit log.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Button variant="outline" asChild>
          <a href={`/api/staff/${staffId}/data`}>Download their data (JSON)</a>
        </Button>
        {anonymized ? (
          <p className="text-sm text-muted-foreground">Personal details were erased. Work and pay records remain.</p>
        ) : (
          <div className="grid gap-2 border-t pt-4">
            <label htmlFor="erase-reason" className="text-sm font-medium">
              Erase personal details
            </label>
            <Textarea id="erase-reason" rows={2} placeholder="Request received (date, channel), verified by…" value={reason} onChange={(e) => setReason(e.target.value)} />
            <ConfirmButton
              variant="outline"
              destructive
              disabled={pending || reason.trim().length < 5}
              title="Erase this person's personal details?"
              description="This can't be undone. Name, contact details, availability, skills, files, notes and evaluations are removed and they're signed out. Bookings, hours, pay and their legal/tax identity are kept for RGXM's records."
              confirmLabel="Erase"
              onConfirm={() =>
                start(async () => {
                  const res = await anonymizeStaffAction(staffId, reason);
                  if (res.ok) {
                    toast.success(res.message ?? "Done");
                    router.refresh();
                  } else toast.error(res.error);
                })
              }
            >
              Erase personal details
            </ConfirmButton>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
