import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/app/action-form";
import { Field } from "@/components/app/form";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatInZone } from "@/lib/format";
import { canAny } from "@/server/authz/permissions";
import { listPrivacyRequests } from "@/server/domain/privacy-ops";
import { requireInternal, toActor } from "@/server/session";
import { getOrgSettings } from "@/server/settings";
import { createRequestAction } from "./actions";
import { KIND_LABEL, STATUS_LABEL } from "./labels";

export const metadata: Metadata = { title: "Privacy requests" };

const OPEN = new Set(["received", "verifying", "in_review"]);
const day = (d: Date | string | null | undefined) => (d ? formatInZone(d, "America/Toronto", "MMM d, yyyy") : "—");

/** Request-time clock, read outside render. */
async function clock() {
  const d = new Date();
  return { now: d.getTime(), today: d.toISOString().slice(0, 10) };
}

export default async function PrivacyRequestsPage() {
  const viewer = await requireInternal("privacy.manage");
  const [rows, settings, { now, today }] = await Promise.all([listPrivacyRequests(), getOrgSettings(), clock()]);

  return (
    <>
      <PageHeader title="Privacy & incidents" description="Access, correction and deletion requests from contractors, and the incident register." />
      <div className="grid gap-6">
        {settings.privacyRequestResponseDays == null ? (
          <p role="status" className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-2.5 text-sm text-warning">
            No response period is set, so new requests don&apos;t get a due date. Set RGXM&apos;s period in{" "}
            <Link href="/dashboard/settings/compliance" className="underline">
              Settings → Contractors &amp; legal
            </Link>
            .
          </p>
        ) : null}
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Requests</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Reference</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Requester</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      No requests yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map(({ r, staffName }) => {
                    const due = r.extendedDueAt ?? r.dueAt;
                    const overdue = due && OPEN.has(r.status) && due.getTime() < now;
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Link href={`/dashboard/privacy/${r.id}`} className="font-medium hover:underline">
                            {r.reference}
                          </Link>
                        </TableCell>
                        <TableCell>{KIND_LABEL[r.kind] ?? r.kind}</TableCell>
                        <TableCell>
                          {r.requesterName}
                          {staffName && staffName !== r.requesterName ? <p className="text-xs text-muted-foreground">Profile: {staffName}</p> : null}
                        </TableCell>
                        <TableCell>
                          <Badge tone={OPEN.has(r.status) ? "info" : "neutral"}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{day(r.receivedAt)}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {due ? (
                            <>
                              {day(due)}
                              {r.extendedDueAt ? <span className="text-xs text-muted-foreground"> (extended)</span> : null}
                              {overdue ? (
                                <Badge tone="danger" className="ml-2">
                                  Overdue
                                </Badge>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-sm text-muted-foreground">No deadline set</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Record a new request</CardTitle>
            <CardDescription>Log it the day it arrives, however it arrived (email, phone, letter).</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={createRequestAction} submitLabel="Record request">
              <div className="grid w-full gap-4 sm:grid-cols-2">
                <Field label="Type of request" htmlFor="pr-kind">
                  <NativeSelect id="pr-kind" name="kind" defaultValue="access">
                    <option value="access">Access (a copy of their information)</option>
                    <option value="correction">Correction</option>
                    <option value="deletion">Deletion</option>
                  </NativeSelect>
                </Field>
                <Field label="Contractor's email in Crew (optional)" htmlFor="pr-email" hint="Links the request to their profile.">
                  <Input id="pr-email" name="staffEmail" type="email" />
                </Field>
                <Field label="Requester's name" htmlFor="pr-name">
                  <Input id="pr-name" name="requesterName" />
                </Field>
                <Field label="How to reach them" htmlFor="pr-contact">
                  <Input id="pr-contact" name="requesterContact" />
                </Field>
                <Field label="Received on" htmlFor="pr-received">
                  <Input id="pr-received" name="receivedAt" type="date" defaultValue={today} />
                </Field>
                <Field label="Received by" htmlFor="pr-via">
                  <Input id="pr-via" name="receivedVia" placeholder="e.g. email to the Privacy Officer" />
                </Field>
                <Field label="What they asked for" htmlFor="pr-details" className="sm:col-span-2">
                  <Textarea id="pr-details" name="details" />
                </Field>
              </div>
            </ActionForm>
          </CardContent>
        </Card>

        {canAny(toActor(viewer), "incidents.manage") ? (
          <Card>
            <CardHeader>
              <CardTitle>Incident register</CardTitle>
              <CardDescription>Record privacy or security incidents: what happened, the risk assessment, who was notified and what was fixed.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/dashboard/incidents" className="text-sm font-medium underline">
                Open the incident register
              </Link>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
