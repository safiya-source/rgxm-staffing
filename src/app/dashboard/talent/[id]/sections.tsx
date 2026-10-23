"use client";
import { format, formatDistanceToNow } from "date-fns";
import { PencilIcon, TrashIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/app/form";
import { MultiSelect, type Option } from "@/components/app/multi-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { formatMoney } from "@/lib/format";
import { FIELD_ROLE_NAMES, FIELD_ROLES, type FieldRole } from "@/lib/roles";
import { useFormAction } from "@/lib/use-form-action";
import {
  addCertificationAction,
  addNoteAction,
  removeCertificationAction,
  setClassificationAction,
  setEmergencyContactAction,
  setRateAction,
  setStaffRolesAction,
  setStaffStatusAction,
  setStaffTagsAction,
} from "../actions";

function useReport() {
  const router = useRouter();
  return (res: ActionResult) => {
    if (res.ok) {
      if (res.message) toast.success(res.message);
      router.refresh();
    } else toast.error(res.error);
  };
}

/** Wraps a bound form action so successes toast and refresh. */
function useBoundForm(action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>, onDone?: () => void) {
  const report = useReport();
  return useFormAction(async (prev, fd) => {
    const res = await action(prev, fd);
    if (res.ok) {
      report(res);
      onDone?.();
    }
    return res;
  });
}

// ─── Status ──────────────────────────────────────────────────────────────────

const STATUS_HELP: Record<string, string> = {
  active: "Can receive offers and be booked.",
  inactive: "Temporarily unavailable; hidden from default searches.",
  suspended: "Can't be offered work until reinstated. A reason is required.",
  archived: "No longer working with RGXM. History is kept. A reason is required.",
};

export function StatusControl({ staffId, status }: { staffId: string; status: string }) {
  const report = useReport();
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState(status);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Change status
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change status</DialogTitle>
          <DialogDescription>Status changes are recorded in the audit log.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {Object.entries(STATUS_HELP).map(([s, help]) => (
            <label key={s} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-foreground/40">
              <input type="radio" name="status" value={s} checked={next === s} onChange={() => setNext(s)} className="mt-1" />
              <span>
                <span className="block text-sm font-medium capitalize">{s}</span>
                <span className="block text-xs text-muted-foreground">{help}</span>
              </span>
            </label>
          ))}
        </div>
        <Field label="Reason" htmlFor="status-reason">
          <Textarea id="status-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </Field>
        <DialogFooter>
          <Button
            disabled={pending || next === status}
            onClick={() =>
              start(async () => {
                const res = await setStaffStatusAction(staffId, next, reason);
                report(res);
                if (res.ok) setOpen(false);
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Roles, skills, languages ────────────────────────────────────────────────

export function RolesEditor({ staffId, roles, canEdit }: { staffId: string; roles: FieldRole[]; canEdit: boolean }) {
  const report = useReport();
  const [value, setValue] = useState<FieldRole[]>(roles);
  const [pending, start] = useTransition();
  const dirty = [...value].sort().join() !== [...roles].sort().join();
  if (!canEdit) {
    return (
      <div className="flex flex-wrap gap-2">
        {roles.length ? roles.map((r) => <Badge key={r}>{FIELD_ROLE_NAMES[r]}</Badge>) : <span className="text-sm text-muted-foreground">None</span>}
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      {FIELD_ROLES.map((r) => (
        <label key={r} className="flex items-center gap-2 text-sm">
          <Checkbox checked={value.includes(r)} onCheckedChange={(c) => setValue((v) => (c ? [...v, r] : v.filter((x) => x !== r)))} />
          {FIELD_ROLE_NAMES[r]}
        </label>
      ))}
      {dirty ? (
        <Button size="sm" className="w-fit" disabled={pending} onClick={() => start(async () => report(await setStaffRolesAction(staffId, value)))}>
          Save roles
        </Button>
      ) : null}
    </div>
  );
}

export function TagsEditor({
  staffId,
  skills,
  languages,
  allSkills,
  allLanguages,
  canEdit,
}: {
  staffId: string;
  skills: Option[];
  languages: Option[];
  allSkills: Option[];
  allLanguages: Option[];
  canEdit: boolean;
}) {
  const report = useReport();
  const [s, setS] = useState(skills.map((x) => x.value));
  const [l, setL] = useState(languages.map((x) => x.value));
  const [pending, start] = useTransition();
  const dirty = [...s].sort().join() !== skills.map((x) => x.value).sort().join() || [...l].sort().join() !== languages.map((x) => x.value).sort().join();
  const chips = (items: Option[]) =>
    items.length ? items.map((x) => <Badge key={x.value} tone="outline">{x.label}</Badge>) : <span className="text-sm text-muted-foreground">None recorded</span>;

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <p className="text-xs font-medium text-muted-foreground">Skills</p>
        <div className="flex flex-wrap gap-1.5">{chips(allSkills.filter((x) => s.includes(x.value)))}</div>
        {canEdit ? <MultiSelect label="Edit skills" options={allSkills} value={s} onChange={setS} className="w-fit" /> : null}
      </div>
      <div className="grid gap-2">
        <p className="text-xs font-medium text-muted-foreground">Languages</p>
        <div className="flex flex-wrap gap-1.5">{chips(allLanguages.filter((x) => l.includes(x.value)))}</div>
        {canEdit ? <MultiSelect label="Edit languages" options={allLanguages} value={l} onChange={setL} className="w-fit" /> : null}
      </div>
      {canEdit && dirty ? (
        <Button size="sm" className="w-fit" disabled={pending} onClick={() => start(async () => report(await setStaffTagsAction(staffId, s, l)))}>
          Save skills & languages
        </Button>
      ) : null}
    </div>
  );
}

// ─── Certifications ──────────────────────────────────────────────────────────

export function CertificationsEditor({
  staffId,
  items,
  options,
  canEdit,
}: {
  staffId: string;
  items: { id: string; name: string; issuedOn: string | null; expiresOn: string | null }[];
  options: Option[];
  canEdit: boolean;
}) {
  const report = useReport();
  const [adding, setAdding] = useState(false);
  const [state, onSubmit, pending] = useBoundForm(addCertificationAction.bind(null, staffId), () => setAdding(false));
  const today = format(new Date(), "yyyy-MM-dd");
  return (
    <div className="grid gap-3">
      {items.length === 0 ? <p className="text-sm text-muted-foreground">None recorded</p> : null}
      <ul className="grid gap-2">
        {items.map((c) => {
          const expired = c.expiresOn !== null && c.expiresOn < today;
          return (
            <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {c.name}
                <span className="block text-xs text-muted-foreground">
                  {c.expiresOn ? `${expired ? "Expired" : "Expires"} ${format(new Date(`${c.expiresOn}T12:00:00`), "MMM d, yyyy")}` : "No expiry recorded"}
                </span>
              </span>
              <span className="flex items-center gap-1">
                {expired ? <Badge tone="danger">Expired</Badge> : null}
                {canEdit ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${c.name}`}
                    onClick={async () => report(await removeCertificationAction(staffId, c.id))}
                  >
                    <TrashIcon />
                  </Button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {canEdit && !adding ? (
        <Button variant="outline" size="sm" className="w-fit" onClick={() => setAdding(true)}>
          Add certification
        </Button>
      ) : null}
      {adding ? (
        <form onSubmit={onSubmit} className="grid gap-3 rounded-lg border p-3">
          <Field label="Certification" htmlFor="certificationId">
            <NativeSelect id="certificationId" name="certificationId" required>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Issued" htmlFor="issuedOn">
              <Input id="issuedOn" name="issuedOn" type="date" />
            </Field>
            <Field label="Expires" htmlFor="expiresOn">
              <Input id="expiresOn" name="expiresOn" type="date" />
            </Field>
          </div>
          {!state.ok ? <FormMessage>{state.error}</FormMessage> : null}
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={pending}>
              Add
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

// ─── Rates ───────────────────────────────────────────────────────────────────

type RateRow = {
  id: string;
  role: FieldRole;
  rateCents: number;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
  setBy: string | null;
};

export function RatesCard({ staffId, rates, roles, canEdit }: { staffId: string; rates: RateRow[]; roles: FieldRole[]; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [state, onSubmit, pending] = useBoundForm(setRateAction.bind(null, staffId), () => setOpen(false));
  const current = rates.filter((r) => !r.effectiveTo);
  const history = rates.filter((r) => r.effectiveTo);
  const e = state.ok ? undefined : state.fieldErrors;

  return (
    <div className="grid gap-3">
      {current.length === 0 ? <p className="text-sm text-muted-foreground">No default rates set.</p> : null}
      <ul className="grid gap-1.5 text-sm">
        {current.map((r) => (
          <li key={r.id} className="flex justify-between gap-3">
            <span>{FIELD_ROLE_NAMES[r.role]}</span>
            <span className="font-medium tabular-nums">{formatMoney(r.rateCents, r.currency)}/hr</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {canEdit ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <PencilIcon /> Set rate
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Set default rate</DialogTitle>
                <DialogDescription>
                  The new rate applies to future offers. Bookings already confirmed keep the rate agreed at confirmation.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={onSubmit} className="grid gap-4">
                <Field label="Role" htmlFor="rate-role">
                  <NativeSelect id="rate-role" name="role" defaultValue={roles[0] ?? "BA"}>
                    {FIELD_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {FIELD_ROLE_NAMES[r]}
                        {roles.includes(r) ? "" : " (not qualified)"}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Hourly rate (CAD)" htmlFor="rate" error={e?.rate}>
                  <Input id="rate" name="rate" inputMode="decimal" placeholder="25.00" required />
                </Field>
                <Field label="Reason (optional)" htmlFor="rate-note">
                  <Input id="rate-note" name="note" placeholder="e.g. Annual review" />
                </Field>
                {!state.ok ? <FormMessage>{state.error}</FormMessage> : null}
                <DialogFooter>
                  <Button type="submit" disabled={pending}>
                    Save rate
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        ) : null}
        {history.length ? (
          <Button variant="ghost" size="sm" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? "Hide history" : `History (${history.length})`}
          </Button>
        ) : null}
      </div>
      {showHistory ? (
        <ul className="grid gap-1.5 border-t pt-3 text-xs text-muted-foreground">
          {history.map((r) => (
            <li key={r.id}>
              {r.role} {formatMoney(r.rateCents, r.currency)} · {format(new Date(r.effectiveFrom), "MMM d, yyyy")} –{" "}
              {format(new Date(r.effectiveTo!), "MMM d, yyyy")}
              {r.setBy ? ` · set by ${r.setBy}` : ""}
              {r.note ? ` · ${r.note}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ─── Pay setup ───────────────────────────────────────────────────────────────

const CLASSIFICATION_LABEL = { unset: "Not set", contractor: "Independent contractor", employee: "Employee (payroll)" } as const;

export function PaySetup({
  staffId,
  pay,
  canEdit,
}: {
  staffId: string;
  pay: { classification: keyof typeof CLASSIFICATION_LABEL; taxRegistered: boolean; gstHstNumber: string | null; legalName: string | null; businessName: string | null };
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [classification, setClassification] = useState(pay.classification);
  const [state, onSubmit, pending] = useBoundForm(setClassificationAction.bind(null, staffId), () => setEditing(false));

  if (!editing) {
    return (
      <div className="grid gap-2 text-sm">
        <p className="flex items-center justify-between gap-2">
          <span>{CLASSIFICATION_LABEL[pay.classification]}</span>
          {pay.classification === "unset" ? <Badge tone="warning">Payments blocked</Badge> : null}
        </p>
        {pay.classification === "contractor" ? (
          <p className="text-muted-foreground">{pay.taxRegistered ? "GST/HST registered" : "Not GST/HST registered"}</p>
        ) : null}
        {canEdit ? (
          <Button variant="outline" size="sm" className="w-fit" onClick={() => setEditing(true)}>
            Edit pay setup
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <p className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
        Worker classification must be determined with RGXM&apos;s accountant or legal advisor. The platform records the decision; it doesn&apos;t make it.
      </p>
      <Field label="Classification" htmlFor="classification">
        <NativeSelect
          id="classification"
          name="classification"
          value={classification}
          onChange={(e) => setClassification(e.target.value as keyof typeof CLASSIFICATION_LABEL)}
        >
          {Object.entries(CLASSIFICATION_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {classification === "contractor" ? (
        <>
          <Field label="Legal name" htmlFor="legalName">
            <Input id="legalName" name="legalName" defaultValue={pay.legalName ?? ""} />
          </Field>
          <Field label="Business name (if any)" htmlFor="businessName">
            <Input id="businessName" name="businessName" defaultValue={pay.businessName ?? ""} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="taxRegistered" defaultChecked={pay.taxRegistered} /> Registered for GST/HST
          </label>
          <Field label="GST/HST number" htmlFor="gstHstNumber" hint="Format: 123456789 RT0001">
            <Input id="gstHstNumber" name="gstHstNumber" defaultValue={pay.gstHstNumber ?? ""} />
          </Field>
        </>
      ) : null}
      {!state.ok ? <FormMessage>{state.error}</FormMessage> : null}
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={pending}>
          Save
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ─── Emergency contact ───────────────────────────────────────────────────────

export function EmergencyContact({
  staffId,
  contact,
  canEdit,
}: {
  staffId: string;
  contact: { name: string | null; phone: string | null; relation: string | null };
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [state, onSubmit, pending] = useBoundForm(setEmergencyContactAction.bind(null, staffId), () => setEditing(false));
  if (!editing) {
    return (
      <div className="grid gap-1 text-sm">
        {contact.name ? (
          <>
            <p className="font-medium">
              {contact.name}
              {contact.relation ? <span className="font-normal text-muted-foreground"> · {contact.relation}</span> : null}
            </p>
            <p>{contact.phone}</p>
          </>
        ) : (
          <p className="text-muted-foreground">Not provided</p>
        )}
        {canEdit ? (
          <Button variant="outline" size="sm" className="mt-2 w-fit" onClick={() => setEditing(true)}>
            Edit
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <Field label="Name" htmlFor="ec-name">
        <Input id="ec-name" name="name" defaultValue={contact.name ?? ""} />
      </Field>
      <Field label="Phone" htmlFor="ec-phone" error={state.ok ? undefined : state.fieldErrors?.phone}>
        <Input id="ec-phone" name="phone" type="tel" defaultValue={contact.phone ?? ""} />
      </Field>
      <Field label="Relationship" htmlFor="ec-relation">
        <Input id="ec-relation" name="relation" defaultValue={contact.relation ?? ""} />
      </Field>
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={pending}>
          Save
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ─── Internal notes ──────────────────────────────────────────────────────────

export function NotesCard({ staffId, notes }: { staffId: string; notes: { id: string; body: string; createdAt: string; author: string | null }[] }) {
  const [state, onSubmit, pending] = useBoundForm(addNoteAction.bind(null, staffId));
  return (
    <div className="grid gap-4">
      <form
        onSubmit={(e) => {
          onSubmit(e);
          e.currentTarget.reset();
        }}
        className="grid gap-2"
      >
        <Textarea name="body" placeholder="Add an internal note (visible to RGXM staff only)" rows={2} aria-label="New note" />
        {!state.ok ? <FormMessage>{state.error}</FormMessage> : null}
        <Button size="sm" type="submit" disabled={pending} className="w-fit">
          Add note
        </Button>
      </form>
      {notes.length === 0 ? <p className="text-sm text-muted-foreground">No notes yet.</p> : null}
      <ul className="grid gap-3">
        {notes.map((n) => (
          <li key={n.id} className="rounded-lg bg-muted/60 p-3 text-sm">
            <p className="whitespace-pre-wrap">{n.body}</p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {n.author ?? "Unknown"} · {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
