"use client";
import { XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { revokeProjectRateAction, setProjectRateAction } from "@/app/dashboard/staffing/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatMoney } from "@/lib/format";
import { FIELD_ROLE_NAMES, FIELD_ROLES, type FieldRole } from "@/lib/roles";

type Override = { id: string; role: FieldRole; staffId: string | null; staffName: string | null; rateCents: number; approvedBy: string | null };

export function RateOverrides({ projectId, overrides, people = [], canEdit }: { projectId: string; overrides: Override[]; people?: { id: string; name: string; rates: string | null }[]; canEdit: boolean }) {
  const router = useRouter();
  const [role, setRole] = useState<FieldRole>("BA");
  const [staffId, setStaffId] = useState("");
  const [rate, setRate] = useState("");
  const [pending, start] = useTransition();
  const done = (res: { ok: boolean; message?: string; error?: string }) => {
    if (res.ok) toast.success(res.message ?? "Saved");
    else toast.error(res.error);
    router.refresh();
  };
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Which rate an offer uses on this project: a rate set here for a specific person, then the person&apos;s own rate (from their talent profile), then the shift&apos;s
        rate, then a role rate set here. Set a person&apos;s rate here when their usual rate doesn&apos;t apply to this project. Confirmed bookings keep their agreed rate.
      </p>
      {overrides.length === 0 ? <p className="text-sm text-muted-foreground">No overrides.</p> : null}
      {overrides.map((o) => (
        <div key={o.id} className="flex items-center justify-between text-sm">
          <span>
            {FIELD_ROLE_NAMES[o.role]} · {o.staffName ?? "everyone"} · <span className="font-medium tabular-nums">{formatMoney(o.rateCents)}/h</span>
            <span className="text-muted-foreground"> · approved by {o.approvedBy ?? "unknown"}</span>
          </span>
          {canEdit ? (
            <Button variant="ghost" size="icon" aria-label="Remove override" onClick={() => start(async () => done(await revokeProjectRateAction(projectId, o.id)))}>
              <XIcon />
            </Button>
          ) : null}
        </div>
      ))}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect value={role} onChange={(e) => setRole(e.target.value as FieldRole)} className="h-9 w-auto" aria-label="Role">
            {FIELD_ROLES.map((r) => (
              <option key={r} value={r}>
                {FIELD_ROLE_NAMES[r]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={staffId} onChange={(e) => setStaffId(e.target.value)} className="h-9 w-64" aria-label="Who it's for">
            <option value="">Everyone in the role</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.rates ? ` (own rate: ${p.rates})` : ""}
              </option>
            ))}
          </NativeSelect>
          <Input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="27.50" inputMode="decimal" className="h-9 w-24" aria-label="Hourly rate" />
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !rate.trim()}
            onClick={() =>
              start(async () => {
                done(await setProjectRateAction(projectId, { role, staffId: staffId || null, rate }));
                setRate("");
              })
            }
          >
            {staffId ? "Set rate for this person" : "Set role rate"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
