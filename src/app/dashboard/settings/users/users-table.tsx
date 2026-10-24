"use client";
import { TimeAgo } from "@/components/app/time-ago";
import { MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/app/form";
import { DemoBadge } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ActionResult } from "@/lib/action-result";
import { useFormAction } from "@/lib/use-form-action";
import { INTERNAL_ROLES, ROLE_LABELS, type InternalRole } from "@/server/authz/permissions";
import { inviteInternalUser, resendInvite, setUserActive, updateUserRoles } from "../actions";

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  status: string;
  twoFactorEnabled: boolean;
  lastSignInAt: string | null;
  isDemo: boolean;
  roles: InternalRole[];
  invitePending: boolean;
};

const ROLE_HELP: Record<InternalRole, string> = {
  admin: "Full access, users, settings and integrations",
  project_manager: "Projects, shifts, briefs, hour approvals",
  staffing_coordinator: "Talent, offers, bookings, communications",
  finance: "Payables, batches, exports, rates",
};

function RoleChecklist({ value, onChange, name }: { value?: InternalRole[]; onChange?: (r: InternalRole[]) => void; name?: string }) {
  return (
    <div className="grid gap-3">
      {INTERNAL_ROLES.map((role) => (
        <label key={role} className="flex cursor-pointer items-start gap-3">
          <Checkbox
            name={name}
            value={role}
            checked={value ? value.includes(role) : undefined}
            onCheckedChange={
              onChange && value
                ? (c) => onChange(c ? [...value, role] : value.filter((r) => r !== role))
                : undefined
            }
            className="mt-0.5"
          />
          <span>
            <span className="block text-sm font-medium">{ROLE_LABELS[role]}</span>
            <span className="block text-xs text-muted-foreground">{ROLE_HELP[role]}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function InviteDialog() {
  const [open, setOpen] = useState(false);
  const [state, onSubmit, pending] = useFormAction(async (prev: ActionResult, formData: FormData) => {
    const result = await inviteInternalUser(prev, formData);
    if (result.ok) {
      toast.success(result.message ?? "Invitation sent.");
      setOpen(false);
    }
    return result;
  });
  const errors = state.ok ? undefined : state.fieldErrors;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon /> Invite team member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
          <DialogDescription>They&apos;ll get an email to set a password. People can hold more than one role.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-5">
          <Field label="Full name" htmlFor="invite-name" error={errors?.name}>
            <Input id="invite-name" name="name" required autoComplete="off" />
          </Field>
          <Field label="Work email" htmlFor="invite-email" error={errors?.email}>
            <Input id="invite-email" name="email" type="email" required autoComplete="off" />
          </Field>
          <div className="grid gap-3">
            <Label>Roles</Label>
            <RoleChecklist name="roles" />
            {errors?.roles ? <p className="text-[13px] text-destructive">{errors.roles[0]}</p> : null}
          </div>
          {!state.ok ? <FormMessage>{state.error}</FormMessage> : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Sending…" : "Send invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditRolesDialog({ member, open, onOpenChange }: { member: TeamMember; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [roles, setRoles] = useState<InternalRole[]>(member.roles);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Roles for {member.name}</DialogTitle>
          <DialogDescription>Changes apply the next time they load a page.</DialogDescription>
        </DialogHeader>
        <RoleChecklist value={roles} onChange={setRoles} />
        <FormMessage>{error}</FormMessage>
        <DialogFooter>
          <Button
            disabled={pending || roles.length === 0}
            onClick={() =>
              start(async () => {
                const res = await updateUserRoles(member.id, roles);
                if (!res.ok) return setError(res.error);
                toast.success(res.message ?? "Saved");
                onOpenChange(false);
                router.refresh();
              })
            }
          >
            {pending ? "Saving…" : "Save roles"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RowActions({ member, isSelf }: { member: TeamMember; isSelf: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const report = (res: ActionResult) => (res.ok ? toast.success(res.message ?? "Done") : toast.error(res.error));
  const active = member.status === "active";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${member.name}`}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(true)}>Edit roles</DropdownMenuItem>
          <DropdownMenuItem onSelect={async () => report(await resendInvite(member.id))}>
            {member.invitePending ? "Resend invitation" : "Send password reset"}
          </DropdownMenuItem>
          {!isSelf ? (
            <DropdownMenuItem
              className={active ? "text-destructive focus:text-destructive" : undefined}
              onSelect={() => setConfirming(true)}
            >
              {active ? "Deactivate" : "Reactivate"}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {editing ? <EditRolesDialog member={member} open={editing} onOpenChange={setEditing} /> : null}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{active ? `Deactivate ${member.name}?` : `Reactivate ${member.name}?`}</DialogTitle>
            <DialogDescription>
              {active
                ? "They'll be signed out immediately and won't be able to sign in. Their history is kept."
                : "They'll be able to sign in again with their existing password."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant={active ? "destructive" : "default"}
              onClick={async () => {
                report(await setUserActive(member.id, !active));
                setConfirming(false);
                router.refresh();
              }}
            >
              {active ? "Deactivate" : "Reactivate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function UsersTable({ members, currentUserId }: { members: TeamMember[]; currentUserId: string }) {
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {members.length} team member{members.length === 1 ? "" : "s"} with dashboard access.
        </p>
        <InviteDialog />
      </div>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Two-step</TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <p className="flex items-center gap-2 font-medium">
                    {m.name} {m.id === currentUserId ? <span className="text-xs font-normal text-muted-foreground">(you)</span> : null}
                    {m.isDemo ? <DemoBadge /> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">{m.email}</p>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {m.roles.length ? m.roles.map((r) => <Badge key={r}>{ROLE_LABELS[r]}</Badge>) : <Badge tone="danger">No role</Badge>}
                  </div>
                </TableCell>
                <TableCell>
                  {m.status !== "active" ? (
                    <Badge tone="neutral">Deactivated</Badge>
                  ) : m.invitePending ? (
                    <Badge tone="warning">Invited</Badge>
                  ) : (
                    <Badge tone="success">Active</Badge>
                  )}
                </TableCell>
                <TableCell>{m.twoFactorEnabled ? <Badge tone="success">On</Badge> : <Badge tone="outline">Off</Badge>}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {m.lastSignInAt ? <TimeAgo date={m.lastSignInAt} /> : "Never"}
                </TableCell>
                <TableCell>
                  <RowActions member={m} isSelf={m.id === currentUserId} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
