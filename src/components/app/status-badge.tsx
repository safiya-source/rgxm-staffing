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

const MAPS = { project: PROJECT, staff: STAFF } as const;

export function StatusBadge({ kind, status }: { kind: keyof typeof MAPS; status: string }) {
  const [label, tone] = MAPS[kind][status] ?? [status, "neutral" as Tone];
  return <Badge tone={tone}>{label}</Badge>;
}

export function DemoBadge() {
  return (
    <Badge tone="warning" title="Demo data: no real messages or payments are ever generated from it">
      Demo
    </Badge>
  );
}
