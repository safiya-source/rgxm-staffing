import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/app/action-form";
import { Field } from "@/components/app/form";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatInZone } from "@/lib/format";
import { INCIDENT_RISK, INCIDENT_STATUSES } from "@/server/db/schema";
import { getIncident } from "@/server/domain/incidents";
import { requireInternal } from "@/server/session";
import { updateIncidentAction } from "../actions";
import { CATEGORY_LABEL, RISK_LABEL, STATUS_LABEL } from "../labels";

export const metadata: Metadata = { title: "Incident" };

const local = (d: Date | null) => (d ? formatInZone(d, "America/Toronto", "yyyy-MM-dd'T'HH:mm") : "");

export default async function IncidentPage({ params }: PageProps<"/dashboard/incidents/[id]">) {
  await requireInternal("incidents.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const i = await getIncident(id);
  if (!i) notFound();
  const closed = i.status === "closed";

  return (
    <>
      <Link href="/dashboard/incidents" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Incident register
      </Link>
      <PageHeader
        title={`${i.reference} · ${i.title}`}
        description={`${CATEGORY_LABEL[i.category] ?? i.category} · detected ${formatInZone(i.detectedAt, "America/Toronto", "MMM d, yyyy h:mm a")}`}
        actions={<Badge tone={closed ? "neutral" : "danger"}>{STATUS_LABEL[i.status]}</Badge>}
      />
      <div className="grid max-w-4xl gap-6">
        <Card>
          <CardContent className="pt-6 text-sm whitespace-pre-wrap">{i.description}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Assessment, notifications and remediation</CardTitle>
          </CardHeader>
          <CardContent>
            {closed ? (
              <dl className="grid gap-2 text-sm">
                <div>
                  <dt className="font-medium">Containment</dt>
                  <dd className="text-muted-foreground">{i.containment ?? "—"}</dd>
                </div>
                <div>
                  <dt className="font-medium">Risk</dt>
                  <dd className="text-muted-foreground">
                    {RISK_LABEL[i.riskAssessment]} — {i.riskRationale ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">Notifications</dt>
                  <dd className="text-muted-foreground">
                    Commissioner: {i.commissionerNotifiedAt ? formatInZone(i.commissionerNotifiedAt, "America/Toronto", "MMM d, yyyy") : "not notified"} · Individuals:{" "}
                    {i.individualsNotifiedAt ? formatInZone(i.individualsNotifiedAt, "America/Toronto", "MMM d, yyyy") : "not notified"}
                    {i.otherNotifications ? ` · ${i.otherNotifications}` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">Remediation</dt>
                  <dd className="text-muted-foreground">{i.remediation ?? "—"}</dd>
                </div>
              </dl>
            ) : (
              <ActionForm action={updateIncidentAction} hidden={{ incidentId: i.id }} submitLabel="Save" keep>
                <div className="grid w-full gap-4 sm:grid-cols-2">
                  <Field label="Containment steps" htmlFor="i-cont" className="sm:col-span-2">
                    <Textarea id="i-cont" name="containment" defaultValue={i.containment ?? ""} />
                  </Field>
                  <Field label="People affected (estimate)" htmlFor="i-aff">
                    <Input id="i-aff" name="affectedPeopleEstimate" inputMode="numeric" defaultValue={i.affectedPeopleEstimate ?? ""} />
                  </Field>
                  <Field label="Kinds of information (comma-separated)" htmlFor="i-data" hint="e.g. contact details, pay amounts">
                    <Input id="i-data" name="dataCategories" defaultValue={i.dataCategories.join(", ")} />
                  </Field>
                  <Field label="Risk assessment" htmlFor="i-risk">
                    <NativeSelect id="i-risk" name="riskAssessment" defaultValue={i.riskAssessment}>
                      {INCIDENT_RISK.map((r) => (
                        <option key={r} value={r}>
                          {RISK_LABEL[r]}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Status" htmlFor="i-status">
                    <NativeSelect id="i-status" name="status" defaultValue={i.status}>
                      {INCIDENT_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Reasoning for the risk assessment" htmlFor="i-rationale" className="sm:col-span-2" hint="Record who made the assessment (Privacy Officer / lawyer).">
                    <Textarea id="i-rationale" name="riskRationale" defaultValue={i.riskRationale ?? ""} />
                  </Field>
                  <Field label="Privacy Commissioner notified" htmlFor="i-comm">
                    <Input id="i-comm" name="commissionerNotifiedAt" type="datetime-local" defaultValue={local(i.commissionerNotifiedAt)} />
                  </Field>
                  <Field label="Individuals notified" htmlFor="i-ind">
                    <Input id="i-ind" name="individualsNotifiedAt" type="datetime-local" defaultValue={local(i.individualsNotifiedAt)} />
                  </Field>
                  <Field label="Other notifications" htmlFor="i-other" className="sm:col-span-2" hint="e.g. client, service provider, police">
                    <Input id="i-other" name="otherNotifications" defaultValue={i.otherNotifications ?? ""} />
                  </Field>
                  <Field label="Remediation" htmlFor="i-rem" className="sm:col-span-2">
                    <Textarea id="i-rem" name="remediation" defaultValue={i.remediation ?? ""} />
                  </Field>
                </div>
              </ActionForm>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
