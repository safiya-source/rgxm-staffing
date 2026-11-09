import { asc, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/app/action-form";
import { Field } from "@/components/app/form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInZone } from "@/lib/format";
import { db } from "@/server/db";
import { projects, staffProfiles } from "@/server/db/schema";
import { activeHolds, listRetentionPolicies, recentRetentionRuns } from "@/server/domain/privacy-ops";
import { requireInternal } from "@/server/session";
import { placeHoldAction, releaseHoldAction, setRetentionAction } from "./actions";

export const metadata: Metadata = { title: "Privacy & retention" };

const day = (d: Date | string | null | undefined) => (d ? formatInZone(d, "America/Toronto", "MMM d, yyyy") : "—");
const ACTION_LABEL: Record<string, string> = {
  delete: "Deleted",
  clear_fields: "Details cleared",
  anonymize: "Personal details erased",
  restricted_archive: "Kept (restricted)",
  not_deletable: "Kept (minimised)",
};
const FIXED = new Set(["expired_sessions", "audit_log", "financial_records"]);

export default async function PrivacySettingsPage() {
  await requireInternal("privacy.manage");
  const [policies, runs, holds, projectRows] = await Promise.all([
    listRetentionPolicies(),
    recentRetentionRuns(30),
    activeHolds(),
    db.select({ id: projects.id, code: projects.code, name: projects.name }).from(projects).orderBy(asc(projects.code)),
  ]);
  const heldStaffIds = holds.map((h) => h.staffId).filter((x): x is string => Boolean(x));
  const heldStaff = heldStaffIds.length ? await db.select({ id: staffProfiles.id, firstName: staffProfiles.firstName, lastName: staffProfiles.lastName }).from(staffProfiles).where(inArray(staffProfiles.id, heldStaffIds)) : [];
  const label = (category: string) => policies.find((p) => p.category === category)?.label ?? category;

  return (
    <div className="grid max-w-5xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Retention periods</CardTitle>
          <CardDescription>
            How long each kind of record is kept before the scheduled clean-up removes it. Use the periods RGXM decided (with legal advice); Crew doesn&apos;t assume any.
            Categories without a period are kept. Check-in locations and email copies keep running with the periods they already had until you change them.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {policies.map((p) => (
            <div key={p.category} className="grid gap-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.label}</span>
                <Badge tone="outline">{ACTION_LABEL[p.action] ?? p.action}</Badge>
                <Badge tone={p.retentionDays != null ? "info" : "neutral"}>{p.retentionDays != null ? `${p.retentionDays} days` : "No period set"}</Badge>
                {p.approvedAt ? <Badge tone="success">Approved {day(p.approvedAt)}</Badge> : p.retentionDays != null ? <Badge tone="warning">Not approved</Badge> : null}
              </div>
              {p.description ? <p className="text-sm text-muted-foreground">{p.description}</p> : null}
              {p.approvalReference ? <p className="text-xs text-muted-foreground">Approval: {p.approvalReference}</p> : null}
              {!FIXED.has(p.category) ? (
                <ActionForm action={setRetentionAction} hidden={{ category: p.category }} submitLabel="Set period">
                  <Input name="days" aria-label="Days" inputMode="numeric" placeholder="Days (blank = keep)" defaultValue={p.retentionDays ?? ""} className="w-40" />
                  <Input name="reference" aria-label="Approval reference" placeholder="Approved by (who and when)" className="w-72" required />
                </ActionForm>
              ) : null}
            </div>
          ))}
          <p className="text-sm text-muted-foreground">
            Deleted records can remain in database backups until those backups expire, and a restore from backup can bring them back. See docs/PRIVACY_OPERATIONS.md for how
            backups expire and what to re-run after a restore.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Legal holds</CardTitle>
          <CardDescription>A hold pauses scheduled deletion and erasure for a contractor, or for everyone who worked on a project, until it&apos;s released.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {holds.length === 0 ? <p className="text-sm text-muted-foreground">No active holds.</p> : null}
          {holds.map((h) => {
            const person = heldStaff.find((s) => s.id === h.staffId);
            const project = projectRows.find((p) => p.id === h.projectId);
            return (
              <div key={h.id} className="grid gap-2 rounded-lg border p-3">
                <p className="text-sm">
                  <span className="font-medium">
                    {person ? (
                      <Link href={`/dashboard/talent/${person.id}`} className="hover:underline">
                        {person.firstName} {person.lastName}
                      </Link>
                    ) : project ? (
                      `Project ${project.code} · ${project.name}`
                    ) : (
                      "Unknown"
                    )}
                  </span>{" "}
                  · since {day(h.placedAt)}
                </p>
                <p className="text-sm text-muted-foreground">{h.reason}</p>
                <ActionForm action={releaseHoldAction} hidden={{ holdId: h.id }} submitLabel="Release" variant="outline">
                  <Input name="reason" aria-label="Reason for release" placeholder="Why it can be released" className="w-72" required />
                </ActionForm>
              </div>
            );
          })}
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">Place a hold</summary>
            <ActionForm action={placeHoldAction} submitLabel="Place hold" className="mt-3">
              <div className="grid w-full gap-3 sm:grid-cols-2">
                <Field label="Contractor's email" htmlFor="hold-email" hint="Or choose a project instead.">
                  <Input id="hold-email" name="email" type="email" />
                </Field>
                <Field label="Project" htmlFor="hold-project">
                  <NativeSelect id="hold-project" name="projectId" defaultValue="">
                    <option value="">—</option>
                    {projectRows.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} · {p.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Reason" htmlFor="hold-reason" className="sm:col-span-2">
                  <Input id="hold-reason" name="reason" placeholder="e.g. Dispute with client; lawyer asked to preserve records" />
                </Field>
              </div>
            </ActionForm>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Deletion report</CardTitle>
          <CardDescription>What the scheduled clean-up removed recently, and how many records it skipped because of a legal hold.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>When</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Removed</TableHead>
                <TableHead className="text-right">Skipped (hold)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                    Nothing has been removed yet.
                  </TableCell>
                </TableRow>
              ) : (
                runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{formatInZone(r.ranAt, "America/Toronto", "MMM d, yyyy h:mm a")}</TableCell>
                    <TableCell>{label(r.category)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.affected}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.skippedHeld}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
