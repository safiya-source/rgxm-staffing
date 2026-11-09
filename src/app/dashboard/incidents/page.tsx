import { ArrowLeftIcon } from "lucide-react";
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
import { listIncidents } from "@/server/domain/incidents";
import { requireInternal } from "@/server/session";
import { reportIncidentAction } from "./actions";
import { CATEGORY_LABEL, RISK_LABEL, STATUS_LABEL } from "./labels";

export const metadata: Metadata = { title: "Incident register" };

export default async function IncidentsPage() {
  await requireInternal("incidents.manage");
  const rows = await listIncidents();
  return (
    <>
      <Link href="/dashboard/privacy" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Privacy & incidents
      </Link>
      <PageHeader
        title="Incident register"
        description="Restricted to administrators. Keep personal details out of the descriptions: describe what kind of information was involved and how many people, not who."
      />
      <div className="grid gap-6">
        <p className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
          RGXM&apos;s Privacy Officer and lawyer decide the legal questions (for example, whether there is a real risk of significant harm and who must be notified). Crew only
          records the decisions and dates. If RGXM already has an approved incident process, follow it and note its reference here.
        </p>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Reference</TableHead>
                  <TableHead>What happened</TableHead>
                  <TableHead>Detected</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      No incidents recorded.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>
                        <Link href={`/dashboard/incidents/${i.id}`} className="font-medium hover:underline">
                          {i.reference}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {i.title}
                        <p className="text-xs text-muted-foreground">{CATEGORY_LABEL[i.category] ?? i.category}</p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatInZone(i.detectedAt, "America/Toronto", "MMM d, yyyy")}</TableCell>
                      <TableCell className="text-sm">{RISK_LABEL[i.riskAssessment]}</TableCell>
                      <TableCell>
                        <Badge tone={i.status === "closed" ? "neutral" : i.status === "contained" ? "info" : "danger"}>{STATUS_LABEL[i.status]}</Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Report an incident</CardTitle>
            <CardDescription>Record it as soon as it&apos;s noticed; you can fill in the assessment afterwards.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={reportIncidentAction} submitLabel="Record incident">
              <div className="grid w-full gap-4 sm:grid-cols-2">
                <Field label="Short title" htmlFor="inc-title">
                  <Input id="inc-title" name="title" />
                </Field>
                <Field label="Kind" htmlFor="inc-cat">
                  <NativeSelect id="inc-cat" name="category" defaultValue="other">
                    {Object.entries(CATEGORY_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Detected" htmlFor="inc-detected">
                  <Input id="inc-detected" name="detectedAt" type="datetime-local" />
                </Field>
                <Field label="What happened" htmlFor="inc-desc" className="sm:col-span-2">
                  <Textarea id="inc-desc" name="description" />
                </Field>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
