import { BriefcaseIcon, InfoIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { DemoBadge, StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateRange, formatMoney } from "@/lib/format";
import { resolveGrant } from "@/server/authz/permissions";
import { getOverview } from "@/server/queries/overview";
import { requireInternal } from "@/server/session";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage({ searchParams }: PageProps<"/dashboard">) {
  const viewer = await requireInternal();
  const { denied } = await searchParams;
  const data = await getOverview();
  // Organisation-wide pay totals: only for roles that see every project's payments (not PMs).
  const showMoney = resolveGrant(viewer.roles, "payments.view") === "all";
  const firstName = viewer.name.split(" ")[0];

  return (
    <>
      <PageHeader title={`Hello, ${firstName}`} description="What's happening across RGXM activations." />

      {denied ? (
        <p role="alert" className="mb-6 rounded-lg bg-danger-soft px-4 py-3 text-sm text-destructive">
          You don&apos;t have access to that page. Ask an administrator if you need it.
        </p>
      ) : null}
      {data.hasDemoData ? (
        <p className="mb-6 flex items-start gap-2 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          This environment contains demo data. Demo records never send real emails or texts and never create real payments.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Active staff" value={data.activeStaff} />
        <StatCard label="Active projects" value={data.activeProjects} />
        <StatCard label="Shifts · next 14 days" value={data.upcomingShifts} />
        <StatCard
          label="Unfilled positions"
          value={data.openPositions}
          tone={data.openPositions > 0 ? "warning" : "default"}
          hint="Across all upcoming shifts"
        />
        <StatCard label="Timesheets to approve" value={data.awaitingApproval} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Projects</CardTitle>
            <Link href="/dashboard/projects" className="text-sm text-muted-foreground hover:text-foreground">
              View all
            </Link>
          </CardHeader>
          <CardContent className="pt-3">
            {data.projects.length === 0 ? (
              <EmptyState
                icon={BriefcaseIcon}
                title="No projects yet"
                description="Projects you create will appear here with their staffing status."
              />
            ) : (
              <ul className="divide-y">
                {data.projects.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate font-medium">
                        {p.name} {p.isDemo ? <DemoBadge /> : null}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {[p.client, p.code, formatDateRange(p.startDate, p.endDate)].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <StatusBadge kind="project" status={p.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Payments</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            {showMoney ? (
              <>
                <p className="text-2xl font-semibold tabular-nums">{formatMoney(data.unpaidCents)}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Approved and not yet paid · {data.unpaidCount} item{data.unpaidCount === 1 ? "" : "s"}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Payment information is visible to Finance and administrators.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
