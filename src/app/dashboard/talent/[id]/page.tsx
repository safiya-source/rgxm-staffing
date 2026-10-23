import { and, eq, isNull } from "drizzle-orm";
import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlannedSection } from "@/components/app/empty-state";
import { DemoBadge, StatusBadge } from "@/components/app/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRate } from "@/lib/format";
import { FIELD_ROLE_NAMES } from "@/lib/roles";
import { canAny } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { staffProfiles, staffRates, staffRoles } from "@/server/db/schema";
import { requireInternal, toActor } from "@/server/session";

export const metadata: Metadata = { title: "Staff profile" };


export default async function StaffProfilePage({ params }: PageProps<"/dashboard/talent/[id]">) {
  const viewer = await requireInternal("talent.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [p] = await db.select().from(staffProfiles).where(eq(staffProfiles.id, id));
  if (!p) notFound();
  const roles = await db.select({ role: staffRoles.role }).from(staffRoles).where(eq(staffRoles.staffId, id));
  const showRates = canAny(toActor(viewer), "rates.view");
  const rates = showRates
    ? await db
        .select({ role: staffRates.role, rateCents: staffRates.rateCents, currency: staffRates.currency })
        .from(staffRates)
        .where(and(eq(staffRates.staffId, id), isNull(staffRates.effectiveTo)))
    : [];
  const name = `${p.preferredName ?? p.firstName} ${p.lastName}`;

  return (
    <>
      <Link href="/dashboard/talent" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Talent
      </Link>
      <div className="mb-8 flex items-center gap-4">
        <Avatar name={name} className="size-14 text-base" />
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            {name} {p.isDemo ? <DemoBadge /> : null}
          </h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge kind="staff" status={p.status} /> {[p.city, p.province].filter(Boolean).join(", ")}
          </p>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p>{p.email}</p>
            <p>{p.phone ?? <span className="text-muted-foreground">No phone on file</span>}</p>
            <p className="text-muted-foreground">{p.userId ? "Has signed in to the staff portal" : "Hasn't signed in yet"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Qualified roles</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {roles.length ? roles.map((r) => <Badge key={r.role}>{FIELD_ROLE_NAMES[r.role]}</Badge>) : <span className="text-sm text-muted-foreground">None recorded</span>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Default rates</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1.5 text-sm">
            {!showRates ? (
              <p className="text-muted-foreground">Restricted</p>
            ) : rates.length ? (
              rates.map((r) => (
                <p key={r.role} className="flex justify-between">
                  <span>{FIELD_ROLE_NAMES[r.role]}</span>
                  <span className="tabular-nums">{formatRate(r.rateCents, r.currency)}</span>
                </p>
              ))
            ) : (
              <p className="text-muted-foreground">No rates set</p>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="mt-6">
        <PlannedSection
          milestone="M2"
          title="Full profile"
          items={["Edit profile, skills, languages, certifications", "Availability and upcoming bookings", "Rate history", "Shift history, reliability and internal notes"]}
        />
      </div>
    </>
  );
}
