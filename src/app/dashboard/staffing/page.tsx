import { PlusIcon, SendIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { DemoBadge, StatusBadge } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInZone } from "@/lib/format";
import { getStaffingOverview } from "@/server/queries/staffing";
import { getOrgSettings } from "@/server/settings";
import { canAny, canOnProject } from "@/server/authz/permissions";
import { loadProjectScopes, requireInternal, toActor } from "@/server/session";

export const metadata: Metadata = { title: "Staffing Requests" };

export default async function StaffingPage() {
  const viewer = await requireInternal("booking.offer");
  const canRequest = canAny(toActor(viewer), "shift.manage");
  const actor = toActor(viewer);
  const [rows, settings] = await Promise.all([getStaffingOverview(), getOrgSettings()]);
  const scopes = await loadProjectScopes(rows.map((r) => r.id));
  const canOffer = (projectId: string) => {
    const scope = scopes.get(projectId);
    return scope ? canOnProject(actor, "booking.offer", scope) : false;
  };
  const newRequest = canRequest ? (
    <Button asChild size="sm">
      <Link href="/dashboard/staffing/new">
        <PlusIcon /> New staffing request
      </Link>
    </Button>
  ) : null;
  return (
    <>
      <PageHeader title="Staffing Requests" description="Send shift offers, review responses and confirm staff." actions={newRequest} />
      {rows.length === 0 ? (
        <EmptyState icon={SendIcon} title="Nothing to staff right now" description="Projects with upcoming published shifts appear here." action={newRequest} />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Project</TableHead>
                <TableHead>Next shift</TableHead>
                <TableHead className="text-right">Filled</TableHead>
                <TableHead className="text-right">Awaiting reply</TableHead>
                <TableHead>Needs you</TableHead>
                <TableHead className="w-0">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/dashboard/staffing/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    {p.isDemo ? <DemoBadge className="ml-1.5" /> : null}
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      {[p.client, p.code].filter(Boolean).join(" · ")} <StatusBadge kind="project" status={p.status} />
                    </p>
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                    {p.nextShift ? formatInZone(p.nextShift, settings.defaultTimezone, "EEE MMM d") : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.confirmed}/{p.positions}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.offered}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {p.toReview ? <Badge tone="brand">{p.toReview} to review</Badge> : null}
                      {p.unreadQuestions ? <Badge tone="info">{p.unreadQuestions} unread message{p.unreadQuestions === 1 ? "" : "s"}</Badge> : null}
                      {p.waitlisted ? <Badge>{p.waitlisted} waitlisted</Badge> : null}
                      {!p.toReview && !p.unreadQuestions && p.confirmed < p.positions && p.offered === 0 ? <Badge tone="warning">Send offers</Badge> : null}
                      {p.confirmed >= p.positions && p.positions > 0 ? <Badge tone="success">Fully staffed</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {canOffer(p.id) && p.confirmed < p.positions ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/dashboard/staffing/${p.id}?offer=1`} aria-label={`Send offers for ${p.name}`}>
                          <SendIcon /> Send offers
                        </Link>
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
