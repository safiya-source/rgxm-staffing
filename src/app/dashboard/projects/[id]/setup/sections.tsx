"use client";
import { MapPinIcon, PencilIcon, PlusIcon, TrashIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { formatDateRange, formatMoney } from "@/lib/format";
import { PROVINCES } from "@/lib/provinces";
import { FIELD_ROLE_NAMES, FIELD_ROLES, type FieldRole } from "@/lib/roles";
import { COMMON_TIME_ZONES } from "@/lib/time";
import { useFormAction } from "@/lib/use-form-action";
import { addMemberAction, deleteLocationAction, deleteRequirementAction, removeMemberAction, saveLocationAction, saveRequirementAction } from "../../actions";

function useDone() {
  const router = useRouter();
  return (res: ActionResult) => {
    if (res.ok) {
      if (res.message) toast.success(res.message);
      router.refresh();
    } else toast.error(res.error);
  };
}

// ─── Locations ──────────────────────────────────────────────────────────────

export type LocationRow = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  province: string | null;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  geofenceMeters: number | null;
  requireLocationAtCheckIn: boolean;
  onsiteContactName: string | null;
  onsiteContactPhone: string | null;
  notes: string | null;
};

function LocationDialog({ projectId, location, open, onOpenChange }: { projectId: string; location: LocationRow | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const done = useDone();
  const [state, onSubmit, pending] = useFormAction(async (prev, fd) => {
    const res = await saveLocationAction(projectId, location?.id ?? null, prev, fd);
    if (res.ok) {
      done(res);
      onOpenChange(false);
    }
    return res;
  });
  const e = state.ok ? undefined : state.fieldErrors;
  const l = location;
  const tzKnown = COMMON_TIME_ZONES.some(([z]) => z === (l?.timezone ?? "America/Toronto"));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{l ? "Edit location" : "Add location"}</DialogTitle>
          <DialogDescription>Shift times at this location are shown in its time zone.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <Field label="Name" htmlFor="loc-name" error={e?.name}>
            <Input id="loc-name" name="name" defaultValue={l?.name ?? ""} required placeholder="Toronto Eaton Centre" />
          </Field>
          <Field label="Address" htmlFor="loc-address" error={e?.address}>
            <Input id="loc-address" name="address" defaultValue={l?.address ?? ""} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="City" htmlFor="loc-city">
              <Input id="loc-city" name="city" defaultValue={l?.city ?? ""} />
            </Field>
            <Field label="Province" htmlFor="loc-province">
              <NativeSelect id="loc-province" name="province" defaultValue={l?.province ?? "ON"}>
                <option value="">—</option>
                {PROVINCES.map(([c]) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Time zone" htmlFor="loc-tz" error={e?.timezone}>
              <NativeSelect id="loc-tz" name="timezone" defaultValue={l?.timezone ?? "America/Toronto"}>
                {!tzKnown && l ? <option value={l.timezone}>{l.timezone}</option> : null}
                {COMMON_TIME_ZONES.map(([z, label]) => (
                  <option key={z} value={z}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="On-site contact" htmlFor="loc-contact">
              <Input id="loc-contact" name="onsiteContactName" defaultValue={l?.onsiteContactName ?? ""} />
            </Field>
            <Field label="On-site contact phone" htmlFor="loc-contact-phone">
              <Input id="loc-contact-phone" name="onsiteContactPhone" type="tel" defaultValue={l?.onsiteContactPhone ?? ""} />
            </Field>
          </div>
          <fieldset className="grid gap-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">Check-in location verification</legend>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox name="requireLocationAtCheckIn" defaultChecked={l?.requireLocationAtCheckIn ?? false} className="mt-0.5" />
              <span>
                Ask staff for their location when they check in or out here
                <span className="block text-xs text-muted-foreground">Captured only at that moment, with a visible prompt. Never tracked otherwise.</span>
              </span>
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Latitude" htmlFor="loc-lat" error={e?.latitude}>
                <Input id="loc-lat" name="latitude" inputMode="decimal" defaultValue={l?.latitude ?? ""} />
              </Field>
              <Field label="Longitude" htmlFor="loc-lng" error={e?.longitude}>
                <Input id="loc-lng" name="longitude" inputMode="decimal" defaultValue={l?.longitude ?? ""} />
              </Field>
              <Field label="Radius (m)" htmlFor="loc-radius" error={e?.geofenceMeters}>
                <Input id="loc-radius" name="geofenceMeters" type="number" min={50} max={5000} defaultValue={l?.geofenceMeters ?? ""} placeholder="300" />
              </Field>
            </div>
          </fieldset>
          <Field label="Notes" htmlFor="loc-notes">
            <Textarea id="loc-notes" name="notes" defaultValue={l?.notes ?? ""} rows={2} />
          </Field>
          {!state.ok ? <FormMessage>{state.error}</FormMessage> : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Save location
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LocationsSection({ projectId, locations, canEdit }: { projectId: string; locations: LocationRow[]; canEdit: boolean }) {
  const done = useDone();
  const [editing, setEditing] = useState<LocationRow | null | "new">(null);
  return (
    <div className="grid gap-3">
      {locations.length === 0 ? <p className="text-sm text-muted-foreground">No locations yet.</p> : null}
      {locations.map((l) => (
        <div key={l.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
          <div className="flex gap-3">
            <MapPinIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="text-sm">
              <p className="font-medium">{l.name}</p>
              <p className="text-muted-foreground">{[l.address, l.timezone].filter(Boolean).join(" · ")}</p>
              {l.requireLocationAtCheckIn ? <p className="text-xs text-muted-foreground">Location checked at check-in ({l.geofenceMeters ?? 300} m)</p> : null}
            </div>
          </div>
          {canEdit ? (
            <div className="flex shrink-0">
              <Button variant="ghost" size="icon" aria-label={`Edit ${l.name}`} onClick={() => setEditing(l)}>
                <PencilIcon />
              </Button>
              <ConfirmButton
                variant="ghost"
                size="icon"
                aria-label={`Remove ${l.name}`}
                title={`Remove ${l.name}?`}
                description="Only locations without shifts can be removed. Its staffing requirements are removed too."
                confirmLabel="Remove"
                destructive
                onConfirm={async () => done(await deleteLocationAction(projectId, l.id))}
              >
                <TrashIcon />
              </ConfirmButton>
            </div>
          ) : null}
        </div>
      ))}
      {canEdit ? (
        <Button variant="outline" size="sm" className="w-fit" onClick={() => setEditing("new")}>
          <PlusIcon /> Add location
        </Button>
      ) : null}
      {editing !== null ? (
        <LocationDialog projectId={projectId} location={editing === "new" ? null : editing} open onOpenChange={(o) => !o && setEditing(null)} />
      ) : null}
    </div>
  );
}

// ─── Requirements ───────────────────────────────────────────────────────────

export type RequirementRow = {
  id: string;
  locationId: string | null;
  role: FieldRole;
  quantity: number;
  defaultRateCents: number | null;
  responsibilities: string | null;
  startDate: string | null;
  endDate: string | null;
};

function RequirementDialog({
  projectId,
  requirement,
  locations,
  showRates,
  onClose,
}: {
  projectId: string;
  requirement: RequirementRow | null;
  locations: LocationRow[];
  showRates: boolean;
  onClose: () => void;
}) {
  const done = useDone();
  const [state, onSubmit, pending] = useFormAction(async (prev, fd) => {
    const res = await saveRequirementAction(projectId, requirement?.id ?? null, prev, fd);
    if (res.ok) {
      done(res);
      onClose();
    }
    return res;
  });
  const e = state.ok ? undefined : state.fieldErrors;
  const r = requirement;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{r ? "Edit requirement" : "Add staffing requirement"}</DialogTitle>
          <DialogDescription>For example: 8 Brand Ambassadors at Location A, Nov 12–15.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid grid-cols-[1fr_6rem] gap-4">
            <Field label="Role" htmlFor="req-role" error={e?.role}>
              <NativeSelect id="req-role" name="role" defaultValue={r?.role ?? "BA"}>
                {FIELD_ROLES.map((x) => (
                  <option key={x} value={x}>
                    {FIELD_ROLE_NAMES[x]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="People" htmlFor="req-qty" error={e?.quantity}>
              <Input id="req-qty" name="quantity" type="number" min={1} defaultValue={r?.quantity ?? 1} required />
            </Field>
          </div>
          <Field label="Location" htmlFor="req-loc">
            <NativeSelect id="req-loc" name="locationId" defaultValue={r?.locationId ?? ""}>
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="From" htmlFor="req-start" error={e?.startDate}>
              <Input id="req-start" name="startDate" type="date" defaultValue={r?.startDate ?? ""} />
            </Field>
            <Field label="To" htmlFor="req-end" error={e?.endDate}>
              <Input id="req-end" name="endDate" type="date" defaultValue={r?.endDate ?? ""} />
            </Field>
          </div>
          {showRates ? (
            <Field label="Default hourly rate (CAD)" htmlFor="req-rate" error={e?.defaultRateCents} hint="Pre-fills new shifts for this role.">
              <Input id="req-rate" name="rate" inputMode="decimal" defaultValue={r?.defaultRateCents != null ? (r.defaultRateCents / 100).toFixed(2) : ""} />
            </Field>
          ) : (
            <input type="hidden" name="rate" value={r?.defaultRateCents != null ? (r.defaultRateCents / 100).toFixed(2) : ""} />
          )}
          <Field label="Responsibilities" htmlFor="req-resp">
            <Textarea id="req-resp" name="responsibilities" defaultValue={r?.responsibilities ?? ""} rows={2} />
          </Field>
          {!state.ok ? <FormMessage>{state.error}</FormMessage> : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RequirementsSection({
  projectId,
  requirements,
  locations,
  canEdit,
  showRates,
}: {
  projectId: string;
  requirements: RequirementRow[];
  locations: LocationRow[];
  canEdit: boolean;
  showRates: boolean;
}) {
  const done = useDone();
  const [editing, setEditing] = useState<RequirementRow | null | "new">(null);
  return (
    <div className="grid gap-3">
      {requirements.length === 0 ? (
        <p className="text-sm text-muted-foreground">No requirements yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Role</TableHead>
              <TableHead className="text-right">People</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Dates</TableHead>
              {showRates ? <TableHead className="text-right">Rate</TableHead> : null}
              {canEdit ? <TableHead className="w-20" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {requirements.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{FIELD_ROLE_NAMES[r.role]}</TableCell>
                <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                <TableCell className="text-muted-foreground">{locations.find((l) => l.id === r.locationId)?.name ?? "All"}</TableCell>
                <TableCell className="text-muted-foreground">{r.startDate ? formatDateRange(r.startDate, r.endDate) : "Project dates"}</TableCell>
                {showRates ? <TableCell className="text-right tabular-nums">{r.defaultRateCents != null ? `${formatMoney(r.defaultRateCents)}/hr` : "—"}</TableCell> : null}
                {canEdit ? (
                  <TableCell>
                    <div className="flex justify-end">
                      <Button variant="ghost" size="icon" aria-label="Edit requirement" onClick={() => setEditing(r)}>
                        <PencilIcon />
                      </Button>
                      <ConfirmButton
                        variant="ghost"
                        size="icon"
                        aria-label="Remove requirement"
                        title="Remove this requirement?"
                        description="Existing shifts are kept; they're just no longer linked to it."
                        confirmLabel="Remove"
                        destructive
                        onConfirm={async () => done(await deleteRequirementAction(projectId, r.id))}
                      >
                        <TrashIcon />
                      </ConfirmButton>
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {canEdit ? (
        <Button variant="outline" size="sm" className="w-fit" onClick={() => setEditing("new")}>
          <PlusIcon /> Add requirement
        </Button>
      ) : null}
      {editing !== null ? (
        <RequirementDialog
          projectId={projectId}
          requirement={editing === "new" ? null : editing}
          locations={locations}
          showRates={showRates}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

// ─── Team ───────────────────────────────────────────────────────────────────

export function TeamSection({
  projectId,
  members,
  team,
  canEdit,
}: {
  projectId: string;
  members: { userId: string; name: string; email: string }[];
  team: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const done = useDone();
  const [selected, setSelected] = useState("");
  const [pending, start] = useTransition();
  const available = team.filter((t) => !members.some((m) => m.userId === t.id));
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        The owner and coordinator always have access. Add other RGXM team members who should be able to manage this project.
      </p>
      {members.map((m) => (
        <div key={m.userId} className="flex items-center justify-between text-sm">
          <span>
            {m.name} <span className="text-muted-foreground">· {m.email}</span>
          </span>
          {canEdit ? (
            <Button variant="ghost" size="icon" aria-label={`Remove ${m.name}`} onClick={async () => done(await removeMemberAction(projectId, m.userId))}>
              <XIcon />
            </Button>
          ) : null}
        </div>
      ))}
      {canEdit && available.length ? (
        <div className="flex gap-2">
          <NativeSelect value={selected} onChange={(e) => setSelected(e.target.value)} className="h-9 max-w-64" aria-label="Team member to add">
            <option value="">Choose a team member…</option>
            {available.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
          <Button
            variant="outline"
            size="sm"
            disabled={!selected || pending}
            onClick={() =>
              start(async () => {
                done(await addMemberAction(projectId, selected));
                setSelected("");
              })
            }
          >
            Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}
