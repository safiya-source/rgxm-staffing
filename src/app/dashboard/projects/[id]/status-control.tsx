"use client";
import { ChevronDownIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { PROJECT_TRANSITIONS, type ProjectStatus } from "@/server/domain/project-status";
import { setProjectStatusAction } from "../actions";

const LABEL: Record<ProjectStatus, string> = {
  draft: "Draft",
  staffing: "Staffing",
  confirmed: "Confirmed",
  live: "Live",
  completed: "Completed",
  reconciliation: "Reconciliation",
  closed: "Closed",
  cancelled: "Cancelled",
};

export function ProjectStatusControl({ projectId, status }: { projectId: string; status: ProjectStatus }) {
  const router = useRouter();
  const [target, setTarget] = useState<ProjectStatus | null>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const options = PROJECT_TRANSITIONS[status];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            Move to… <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Currently {LABEL[status]}</DropdownMenuLabel>
          {options.map((s) => (
            <DropdownMenuItem key={s} onSelect={() => setTarget(s)} className={s === "cancelled" ? "text-destructive focus:text-destructive" : undefined}>
              {LABEL[s]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move project to {target ? LABEL[target] : ""}?</DialogTitle>
            <DialogDescription>
              {target === "cancelled"
                ? "Shifts and bookings are kept for history. Cancel individual shifts to release staff."
                : "The change is recorded in the audit log."}
            </DialogDescription>
          </DialogHeader>
          <Field label={target === "cancelled" ? "Reason (required)" : "Note (optional)"} htmlFor="status-reason">
            <Textarea id="status-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button
              variant={target === "cancelled" ? "destructive" : "default"}
              disabled={pending || (target === "cancelled" && !reason.trim())}
              onClick={() =>
                start(async () => {
                  const res = await setProjectStatusAction(projectId, target!, reason);
                  if (res.ok) {
                    toast.success(res.message ?? "Updated");
                    setTarget(null);
                    setReason("");
                    router.refresh();
                  } else toast.error(res.error);
                })
              }
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
