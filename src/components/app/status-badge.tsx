import { Badge } from "@/components/ui/badge";

type Tone = "neutral" | "success" | "warning" | "info" | "danger" | "brand" | "outline";

const PROJECT: Record<string, [string, Tone]> = {
  draft: ["Draft", "outline"],
  staffing: ["Staffing", "info"],
  confirmed: ["Confirmed", "success"],
  live: ["Live", "brand"],
  completed: ["Completed", "neutral"],
  reconciliation: ["Reconciliation", "warning"],
  closed: ["Closed", "neutral"],
  cancelled: ["Cancelled", "danger"],
};

const STAFF: Record<string, [string, Tone]> = {
  active: ["Active", "success"],
  inactive: ["Inactive", "neutral"],
  suspended: ["Suspended", "danger"],
  archived: ["Archived", "outline"],
};

const BOOKING: Record<string, [string, Tone]> = {
  draft: ["Draft", "outline"],
  offered: ["Offered", "info"],
  interested: ["Interested", "brand"],
  declined: ["Declined", "neutral"],
  awaiting_confirmation: ["Awaiting confirmation", "warning"],
  confirmed: ["Confirmed", "success"],
  waitlisted: ["Waitlisted", "neutral"],
  cancelled: ["Cancelled", "danger"],
  completed: ["Completed", "neutral"],
  no_show: ["No-show", "danger"],
};

const SHIFT: Record<string, [string, Tone]> = {
  draft: ["Draft", "outline"],
  open: ["Open", "info"],
  filled: ["Filled", "success"],
  live: ["Live", "brand"],
  completed: ["Completed", "neutral"],
  cancelled: ["Cancelled", "danger"],
};

const PAYABLE: Record<string, [string, Tone]> = {
  pending: ["Ready to batch", "info"],
  batched: ["In a batch", "brand"],
  exported: ["Exported", "brand"],
  paid: ["Paid", "success"],
  failed: ["Payment failed", "danger"],
  disputed: ["Disputed", "warning"],
  void: ["Void", "outline"],
};

const BATCH: Record<string, [string, Tone]> = {
  draft: ["Draft · needs approval", "warning"],
  approved: ["Approved", "info"],
  exported: ["Exported", "brand"],
  paid: ["Paid", "success"],
  void: ["Void", "outline"],
};

const MAPS = { project: PROJECT, staff: STAFF, booking: BOOKING, shift: SHIFT, payable: PAYABLE, batch: BATCH } as const;

export function StatusBadge({ kind, status }: { kind: keyof typeof MAPS; status: string }) {
  const [label, tone] = MAPS[kind][status] ?? [status, "neutral" as Tone];
  return <Badge tone={tone}>{label}</Badge>;
}

export function DemoBadge({ className }: { className?: string }) {
  return (
    <Badge tone="warning" className={className} title="Demo data: no real messages or payments are ever generated from it">
      Demo
    </Badge>
  );
}
