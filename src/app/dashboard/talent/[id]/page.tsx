import { format } from "date-fns";
import { ArrowLeftIcon, MailIcon, PhoneIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoBadge, StatusBadge } from "@/components/app/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WEEKDAYS } from "@/lib/availability";
import { formatInZone, formatMinutes } from "@/lib/format";
import { canAny } from "@/server/authz/permissions";
import { getTalentLookups } from "@/server/domain/talent";
import { getStaffDetail } from "@/server/queries/staff-detail";
import { requireInternal, toActor } from "@/server/session";
import { updateStaffAction } from "../actions";
import { StaffForm } from "../staff-form";
import { PrivacyCard } from "./privacy-card";
import { CertificationsEditor, EmergencyContact, NotesCard, PaySetup, RatesCard, RolesEditor, StatusControl, TagsEditor } from "./sections";

export const metadata: Metadata = { title: "Staff profile" };

const time = (t: string) => format(new Date(`2000-01-01T${t}`), "h:mm a");

export default async function StaffProfilePage({ params }: PageProps<"/dashboard/talent/[id]">) {
  const viewer = await requireInternal("talent.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const actor = toActor(viewer);
  const can = {
    edit: canAny(actor, "talent.edit"),
    rates: canAny(actor, "rates.view"),
    editRates: canAny(actor, "rates.edit"),
    notes: canAny(actor, "talent.notes.view"),
    privacy: canAny(actor, "privacy.manage"),
  };
  const detail = await getStaffDetail(id, actor, can);
  if (!detail) notFound();
  const lookups = await getTalentLookups();
  const p = detail.profile;
  const name = `${p.preferredName ?? p.firstName} ${p.lastName}`;
  const toOption = (x: { id: string; name: string }) => ({ value: x.id, label: x.name });

  return (
    <>
      <Link href="/dashboard/talent" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Talent
      </Link>

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar name={name} className="size-14 text-base" />
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
              {name} <StatusBadge kind="staff" status={p.status} /> {p.isDemo ? <DemoBadge /> : null}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                <MailIcon className="size-3.5" /> {p.email}
              </a>
              {p.phone ? (
                <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                  <PhoneIcon className="size-3.5" /> {p.phone}
                </a>
              ) : null}
              <span>{[p.city, p.province].filter(Boolean).join(", ") || "Location not set"}</span>
              <span>{p.userId ? "Uses the staff portal" : "Hasn't signed in yet"}</span>
            </p>
          </div>
        </div>
        {can.edit ? <StatusControl staffId={p.id} status={p.status} /> : null}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Completed shifts", detail.stats.completed],
          ["Approved hours", formatMinutes(detail.stats.approvedMinutes)],
          ["Projects", detail.stats.projects],
          ["Staff cancellations", detail.stats.staffCancellations],
          ["No-shows", detail.stats.noShows],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-xl border bg-card p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Upcoming</CardTitle>
              <CardDescription>Offers and bookings that haven&apos;t happened yet.</CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              {detail.upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
              ) : (
                <ul className="divide-y">
                  {detail.upcoming.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span>
                        <span className="font-medium">{formatInZone(b.startsAt, b.timezone, "EEE MMM d, h:mm a")}</span>
                        <span className="block text-muted-foreground">
                          <Link href={`/dashboard/projects/${b.projectId}`} className="hover:underline">
                            {b.projectName}
                          </Link>{" "}
                          · {b.locationName} · {b.role}
                        </span>
                      </span>
                      <StatusBadge kind="booking" status={b.status} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Availability</CardTitle>
              <CardDescription>Set by the staff member in their portal. Availability is a preference, not a booking.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 pt-2 text-sm sm:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Usually available</p>
                {detail.availability.rules.length === 0 ? (
                  <p className="text-muted-foreground">No weekly pattern set</p>
                ) : (
                  <ul className="grid gap-1">
                    {detail.availability.rules.map((r) => (
                      <li key={r.id}>
                        <span className="inline-block w-10 font-medium">{WEEKDAYS[r.weekday]}</span> {time(r.startTime)} – {time(r.endTime)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Specific dates</p>
                {detail.availability.exceptions.length === 0 ? (
                  <p className="text-muted-foreground">None upcoming</p>
                ) : (
                  <ul className="grid gap-1">
                    {detail.availability.exceptions.map((e) => (
                      <li key={e.id} className="flex items-center gap-2">
                        {format(new Date(`${e.date}T12:00:00`), "EEE MMM d")}
                        <Badge tone={e.kind === "available" ? "success" : "danger"}>{e.kind === "available" ? "Available" : "Unavailable"}</Badge>
                        {e.startTime && e.endTime ? (
                          <span className="text-muted-foreground">
                            {time(e.startTime)}–{time(e.endTime)}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent>
              {can.edit ? (
                <StaffForm action={updateStaffAction.bind(null, p.id)} values={p} mode="edit" emailLocked={Boolean(p.userId)} />
              ) : (
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  {[
                    ["Service area", p.serviceArea],
                    ["Experience", p.experienceYears !== null ? `${p.experienceYears} years` : null],
                    ["Vehicle", p.hasVehicle === null ? null : p.hasVehicle ? "Yes" : "No"],
                    ["Willing to travel", p.willingToTravel === null ? null : p.willingToTravel ? `Yes${p.travelRadiusKm ? `, ${p.travelRadiusKm} km` : ""}` : "No"],
                    ["Preferred hours", p.preferredHours],
                    ["Experience summary", p.experienceSummary],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd>{v ?? "—"}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              {detail.recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">No past shifts yet.</p>
              ) : (
                <ul className="divide-y">
                  {detail.recent.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span>
                        {formatInZone(b.startsAt, b.timezone, "MMM d, yyyy")} · {b.projectName} · {b.role}
                      </span>
                      <StatusBadge kind="booking" status={b.status} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {detail.notes ? (
            <Card>
              <CardHeader>
                <CardTitle>Internal notes</CardTitle>
                <CardDescription>Only visible to authorised RGXM staff. Never shown to the staff member.</CardDescription>
              </CardHeader>
              <CardContent>
                <NotesCard staffId={p.id} notes={detail.notes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() }))} />
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="grid content-start gap-6">
          {can.privacy && !p.isDemo ? <PrivacyCard staffId={p.id} anonymized={Boolean(p.anonymizedAt)} /> : null}
          <Card>
            <CardHeader>
              <CardTitle>Qualified roles</CardTitle>
            </CardHeader>
            <CardContent>
              <RolesEditor staffId={p.id} roles={detail.roles} canEdit={can.edit} />
            </CardContent>
          </Card>

          {detail.rates ? (
            <Card>
              <CardHeader>
                <CardTitle>Default rates</CardTitle>
                <CardDescription>Confidential. Never visible to other staff.</CardDescription>
              </CardHeader>
              <CardContent>
                <RatesCard
                  staffId={p.id}
                  roles={detail.roles}
                  canEdit={can.editRates}
                  rates={detail.rates.map((r) => ({
                    ...r,
                    effectiveFrom: r.effectiveFrom.toISOString(),
                    effectiveTo: r.effectiveTo?.toISOString() ?? null,
                  }))}
                />
              </CardContent>
            </Card>
          ) : null}

          {detail.pay ? (
            <Card>
              <CardHeader>
                <CardTitle>Pay setup</CardTitle>
              </CardHeader>
              <CardContent>
                <PaySetup staffId={p.id} pay={detail.pay} canEdit={can.editRates} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Skills & languages</CardTitle>
            </CardHeader>
            <CardContent>
              <TagsEditor
                staffId={p.id}
                skills={detail.skills.map(toOption)}
                languages={detail.languages.map(toOption)}
                allSkills={lookups.skills.map(toOption)}
                allLanguages={lookups.languages.map(toOption)}
                canEdit={can.edit}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Certifications</CardTitle>
            </CardHeader>
            <CardContent>
              <CertificationsEditor
                staffId={p.id}
                items={detail.certifications}
                options={lookups.certifications.map(toOption)}
                canEdit={can.edit}
              />
            </CardContent>
          </Card>

          {detail.emergency ? (
            <Card>
              <CardHeader>
                <CardTitle>Emergency contact</CardTitle>
                <CardDescription>Restricted.</CardDescription>
              </CardHeader>
              <CardContent>
                <EmergencyContact staffId={p.id} contact={detail.emergency} canEdit={can.edit} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Lists</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              {detail.lists.length === 0 ? <p className="text-sm text-muted-foreground">Not on any list</p> : null}
              {detail.lists.map((l) => (
                <Link key={l.id} href={`/dashboard/talent?list=${l.id}`}>
                  <Badge tone="outline" className="hover:bg-accent">
                    {l.name}
                  </Badge>
                </Link>
              ))}
            </CardContent>
          </Card>
          <p className="px-1 text-xs text-muted-foreground">
            Profile created {format(p.createdAt, "MMM d, yyyy")}
          </p>
        </div>
      </div>
    </>
  );
}
