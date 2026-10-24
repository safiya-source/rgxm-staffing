// Outbox event → notifications. Handlers re-read current data, so a retried event reflects the
// latest state, and every notification uses a dedupe key derived from the event id.
import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import { formatInZone, formatMoney } from "@/lib/format";
import { FIELD_ROLE_NAMES, type FieldRole } from "@/lib/roles";
import { db } from "@/server/db";
import {
  announcements,
  bookings,
  documents,
  messages,
  messageThreads,
  projectLocations,
  projectMembers,
  projects,
  shifts,
  staffProfiles,
  timesheets,
  userRoles,
  users,
} from "@/server/db/schema";
import { env } from "@/server/env";
import { notify } from "./notify";
import type { Handler } from "./outbox";
import { detailEmail } from "./templates";

const url = (path: string) => `${env.APP_URL}${path}`;

async function staffRecipient(staffId: string) {
  const [s] = await db
    .select({ userId: staffProfiles.userId, email: staffProfiles.email, firstName: staffProfiles.firstName, preferredName: staffProfiles.preferredName })
    .from(staffProfiles)
    .where(eq(staffProfiles.id, staffId));
  if (!s) throw new Error(`Staff ${staffId} not found`);
  return { ...s, name: s.preferredName ?? s.firstName };
}

/** Owner, coordinator and members of a project (active internal users). */
async function projectTeam(projectId: string) {
  const [p] = await db.select({ ownerId: projects.ownerId, coordinatorId: projects.coordinatorId }).from(projects).where(eq(projects.id, projectId));
  const members = await db.select({ userId: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, projectId));
  const ids = [...new Set([p?.ownerId, p?.coordinatorId, ...members.map((m) => m.userId)].filter((x): x is string => Boolean(x)))];
  if (!ids.length) return [];
  return db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.status, "active")))
    .then((r) => r.map((x) => x.id));
}

async function loadBookings(ids: string[]) {
  return db
    .select({
      id: bookings.id,
      shiftId: bookings.shiftId,
      staffId: bookings.staffId,
      status: bookings.status,
      role: bookings.role,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      offeredRateCents: bookings.offeredRateCents,
      agreedRateCents: bookings.agreedRateCents,
      currency: bookings.currency,
      responseDeadline: bookings.responseDeadline,
      cancelReason: bookings.cancelReason,
      waitlistPosition: bookings.waitlistPosition,
      projectId: projects.id,
      projectName: projects.name,
      timezone: shifts.timezone,
      locationName: projectLocations.name,
      address: projectLocations.address,
      reportingLocation: shifts.reportingLocation,
      onsiteContact: shifts.onsiteContact,
      uniform: shifts.uniform,
    })
    .from(bookings)
    .innerJoin(shifts, eq(shifts.id, bookings.shiftId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .innerJoin(projectLocations, eq(projectLocations.id, shifts.locationId))
    .where(inArray(bookings.id, ids))
    .orderBy(bookings.startsAt);
}
type LoadedBooking = Awaited<ReturnType<typeof loadBookings>>[number];

const when = (b: Pick<LoadedBooking, "startsAt" | "endsAt" | "timezone">) =>
  `${formatInZone(b.startsAt, b.timezone, "EEE MMM d, h:mm a")} – ${formatInZone(b.endsAt, b.timezone, "h:mm a")}`;
const roleName = (r: string) => FIELD_ROLE_NAMES[r as FieldRole] ?? r;

/** Users of TL/AM staff who supervise this booking on site. */
async function supervisorUserIds(bookingId: string) {
  const r = await db.execute<{ user_id: string }>(sql`
    select distinct sp.user_id from bookings b
    join shifts s on s.id = b.shift_id
    join bookings sb on sb.project_id = b.project_id and sb.status in ('confirmed', 'completed') and sb.staff_id <> b.staff_id
      and ((sb.role = 'AM' and b.role <> 'AM') or (sb.role = 'TL' and b.role in ('BA', 'PA')))
    join shifts ss on ss.id = sb.shift_id and ss.location_id = s.location_id
      and (ss.starts_at at time zone ss.timezone)::date = (s.starts_at at time zone s.timezone)::date
    join staff_profiles sp on sp.id = sb.staff_id
    where b.id = ${bookingId} and sp.user_id is not null`);
  return r.rows.map((x) => x.user_id);
}

async function timesheetContext(timesheetId: string) {
  const [t] = await db
    .select({ id: timesheets.id, bookingId: timesheets.bookingId, payableMinutes: timesheets.payableMinutes, reviewNote: timesheets.reviewNote })
    .from(timesheets)
    .where(eq(timesheets.id, timesheetId));
  if (!t) return null;
  const [b] = await loadBookings([t.bookingId]);
  return b ? { t, b } : null;
}

const hours = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}m` : ""}`;

export const handlers: Record<string, Handler> = {
  "shift.reminder": async (payload, eventId) => {
    const [b] = await loadBookings([payload.bookingId as string]);
    if (!b || b.status !== "confirmed" || b.startsAt < new Date()) return;
    const person = await staffRecipient(b.staffId);
    const [{ pending }] = (await db.execute<{ pending: number }>(sql`
      select count(*)::int as pending from documents d
      where d.project_id = ${b.projectId} and d.requires_ack and d.archived_at is null
        and (d.shift_id is null or d.shift_id = ${b.shiftId})
        and not exists (select 1 from document_acknowledgements a where a.document_id = d.id and a.document_version = d.version and a.staff_id = ${b.staffId})`)).rows as [{ pending: number }];
    await notify({
      dedupeKey: `n:${eventId}`,
      userId: person.userId,
      type: "shift.reminder",
      title: `Reminder: ${b.projectName}, ${formatInZone(b.startsAt, b.timezone, "EEE h:mm a")}`,
      body: pending ? `${pending} brief${pending === 1 ? "" : "s"} still to review.` : b.locationName,
      href: `/portal/shifts/${b.id}`,
      email: {
        to: person.email,
        subject: `Reminder: your shift ${formatInZone(b.startsAt, b.timezone, "EEEE 'at' h:mm a")}`,
        ...detailEmail({
          heading: `See you soon, ${person.name}`,
          intro: pending
            ? `Please review ${pending} briefing document${pending === 1 ? "" : "s"} before your shift.`
            : "Here are your shift details. Check in from the staff portal when you arrive.",
          details: [
            ["Project", b.projectName],
            ["When", when(b)],
            ["Where", [b.locationName, b.address].filter(Boolean).join(", ")],
            ...(b.reportingLocation ? ([["Report to", b.reportingLocation]] as [string, string][]) : []),
            ...(b.uniform ? ([["Uniform", b.uniform]] as [string, string][]) : []),
          ],
          actionLabel: "Open shift",
          url: url(`/portal/shifts/${b.id}`),
        }),
      },
    });
  },

  "timesheet.reminder": async (payload, eventId) => {
    const [b] = await loadBookings([payload.bookingId as string]);
    if (!b) return;
    const [t] = await db.select({ status: timesheets.status }).from(timesheets).where(eq(timesheets.bookingId, b.id));
    if (t && !["not_started", "in_progress", "needs_review"].includes(t.status)) return;
    const person = await staffRecipient(b.staffId);
    await notify({
      dedupeKey: `n:${eventId}`,
      userId: person.userId,
      type: "timesheet.reminder",
      title: `Please confirm your hours: ${b.projectName}`,
      body: when(b),
      href: `/portal/shifts/${b.id}`,
      email: {
        to: person.email,
        subject: `Confirm your hours for ${b.projectName}, ${formatInZone(b.startsAt, b.timezone, "MMM d")}`,
        ...detailEmail({
          heading: `Thanks for working, ${person.name}`,
          intro: "Please review your start and finish times, add any unpaid break, and submit. It only takes a moment.",
          details: [
            ["Project", b.projectName],
            ["Shift", when(b)],
          ],
          actionLabel: "Review my hours",
          url: url(`/portal/shifts/${b.id}`),
        }),
      },
    });
  },

  "timesheet.submitted": async (payload, eventId) => {
    const c = await timesheetContext(payload.timesheetId as string);
    if (!c) return;
    const person = await staffRecipient(c.b.staffId);
    const supervisors = await supervisorUserIds(c.b.id);
    for (const userId of supervisors) {
      await notify({
        dedupeKey: `n:${eventId}:${userId}`,
        userId,
        type: "timesheet.submitted",
        title: `${person.name} submitted hours to verify`,
        body: `${c.b.projectName} · ${formatInZone(c.b.startsAt, c.b.timezone, "MMM d")}`,
        href: "/portal/team",
      });
    }
    if (!supervisors.length) {
      for (const userId of await projectTeam(c.b.projectId)) {
        await notify({
          dedupeKey: `n:${eventId}:${userId}`,
          userId,
          type: "timesheet.submitted",
          title: `${person.name} submitted hours`,
          body: `${c.b.projectName} · ${formatInZone(c.b.startsAt, c.b.timezone, "MMM d")}`,
          href: `/dashboard/timesheets/${c.t.id}`,
        });
      }
    }
  },

  "timesheet.needs_review": async (payload, eventId) => {
    const c = await timesheetContext(payload.timesheetId as string);
    if (!c) return;
    const person = await staffRecipient(c.b.staffId);
    await notify({
      dedupeKey: `n:${eventId}`,
      userId: person.userId,
      type: "timesheet.needs_review",
      title: `Please check your hours: ${c.b.projectName}`,
      body: c.t.reviewNote ?? undefined,
      href: `/portal/shifts/${c.b.id}`,
      email: {
        to: person.email,
        subject: `Please check your hours for ${c.b.projectName}`,
        ...detailEmail({
          heading: `Hi ${person.name}, your hours need a quick check`,
          intro: c.t.reviewNote ?? "Please review your times and resubmit.",
          details: [["Shift", when(c.b)]],
          actionLabel: "Review my hours",
          url: url(`/portal/shifts/${c.b.id}`),
        }),
      },
    });
  },

  "timesheet.approved": async (payload, eventId) => {
    const c = await timesheetContext(payload.timesheetId as string);
    if (!c || c.t.payableMinutes == null) return;
    const person = await staffRecipient(c.b.staffId);
    await notify({
      dedupeKey: `n:${eventId}`,
      userId: person.userId,
      type: "timesheet.approved",
      title: `${payload.corrected ? "Hours corrected" : "Hours approved"}: ${hours(c.t.payableMinutes)}`,
      body: `${c.b.projectName} · ${formatInZone(c.b.startsAt, c.b.timezone, "MMM d")}`,
      href: `/portal/shifts/${c.b.id}`,
    });
  },

  "offer.sent": async (payload, eventId) => {
    const list = await loadBookings(payload.bookingIds as string[]);
    const open = list.filter((b) => b.status === "offered");
    if (!open.length) return;
    const first = open[0]!;
    const person = await staffRecipient(first.staffId);
    const deadline = first.responseDeadline ? formatInZone(first.responseDeadline, first.timezone, "EEE MMM d, h:mm a") : null;
    const details: [string, string][] = [
      ["Project", first.projectName],
      ["Role", roleName(first.role)],
      ["Location", [first.locationName, first.address].filter(Boolean).join(", ")],
      ...open.map((b, i): [string, string] => [i === 0 ? (open.length > 1 ? "Shifts" : "Shift") : "", when(b)]),
      ["Rate", `${formatMoney(first.offeredRateCents ?? 0, first.currency)}/hour`],
      ...(deadline ? ([["Respond by", deadline]] as [string, string][]) : []),
    ];
    const title = open.length > 1 ? `${open.length} shift offers: ${first.projectName}` : `Shift offer: ${first.projectName}`;
    await notify({
      dedupeKey: `n:${eventId}`,
      userId: person.userId,
      type: "offer",
      title,
      body: `${roleName(first.role)} · ${when(first)}${open.length > 1 ? ` and ${open.length - 1} more` : ""}`,
      href: "/portal/opportunities",
      email: {
        to: person.email,
        subject: title,
        ...detailEmail({
          heading: `Hi ${person.name}, are you available?`,
          intro: "RGXM has a shift opportunity for you. Let us know if you're interested. This isn't a booking yet; we'll confirm with you.",
          details,
          actionLabel: "Respond to the offer",
          url: url("/portal/opportunities"),
        }),
      },
    });
  },

  "offer.response": async (payload, eventId) => {
    const [b] = await loadBookings([payload.bookingId as string]);
    if (!b) return;
    const person = await staffRecipient(b.staffId);
    const response = payload.response as string;
    const verb = response === "interested" ? "is interested in" : response === "more_info" ? "has a question about" : "is unavailable for";
    for (const userId of await projectTeam(b.projectId)) {
      await notify({
        dedupeKey: `n:${eventId}:${userId}`,
        userId,
        type: `offer.${response}`,
        title: `${person.name} ${verb} ${roleName(b.role)} · ${formatInZone(b.startsAt, b.timezone, "MMM d")}`,
        body: b.projectName,
        href: `/dashboard/staffing/${b.projectId}`,
      });
    }
  },

  "booking.confirmed": async (payload, eventId) => {
    const [b] = await loadBookings([payload.bookingId as string]);
    if (!b || b.status !== "confirmed") return;
    const person = await staffRecipient(b.staffId);
    const details: [string, string][] = [
      ["Project", b.projectName],
      ["Role", roleName(b.role)],
      ["When", when(b)],
      ["Where", [b.locationName, b.address].filter(Boolean).join(", ")],
      ...(b.reportingLocation ? ([["Report to", b.reportingLocation]] as [string, string][]) : []),
      ...(b.onsiteContact ? ([["On-site contact", b.onsiteContact]] as [string, string][]) : []),
      ...(b.uniform ? ([["Uniform", b.uniform]] as [string, string][]) : []),
      ["Agreed rate", `${formatMoney(b.agreedRateCents ?? 0, b.currency)}/hour`],
    ];
    await notify({
      dedupeKey: `n:${eventId}`,
      userId: person.userId,
      type: "booking.confirmed",
      title: `You're booked: ${b.projectName}`,
      body: when(b),
      href: `/portal/shifts/${b.id}`,
      email: {
        to: person.email,
        subject: `Booking confirmed: ${b.projectName}, ${formatInZone(b.startsAt, b.timezone, "MMM d")}`,
        ...detailEmail({
          heading: `You're confirmed, ${person.name}`,
          intro: "Here are your shift details. Please review any briefing documents before your shift.",
          details,
          actionLabel: "View shift and briefs",
          url: url(`/portal/shifts/${b.id}`),
        }),
      },
    });
  },

  "booking.cancelled": async (payload, eventId) => {
    const [b] = await loadBookings([payload.bookingId as string]);
    if (!b) return;
    const person = await staffRecipient(b.staffId);
    if (payload.byStaff) {
      const [{ waiting }] = (await db
        .select({ waiting: count() })
        .from(bookings)
        .where(and(eq(bookings.shiftId, b.shiftId), eq(bookings.status, "waitlisted")))) as [{ waiting: number }];
      for (const userId of await projectTeam(b.projectId)) {
        await notify({
          dedupeKey: `n:${eventId}:${userId}`,
          userId,
          type: "booking.staff_cancelled",
          title: `${person.name} cancelled ${roleName(b.role)} · ${formatInZone(b.startsAt, b.timezone, "MMM d")}`,
          body: `${b.projectName}. ${waiting ? `${waiting} on the waitlist.` : "Nobody on the waitlist."}${b.cancelReason ? ` Reason: ${b.cancelReason}` : ""}`,
          href: `/dashboard/staffing/${b.projectId}`,
        });
      }
      return;
    }
    await notify({
      dedupeKey: `n:${eventId}`,
      userId: person.userId,
      type: "booking.cancelled",
      title: `Cancelled: ${b.projectName}, ${formatInZone(b.startsAt, b.timezone, "MMM d")}`,
      body: b.cancelReason ?? undefined,
      href: "/portal/schedule",
      email: {
        to: person.email,
        subject: `Update on ${b.projectName}, ${formatInZone(b.startsAt, b.timezone, "MMM d")}`,
        ...detailEmail({
          heading: `Hi ${person.name}`,
          intro: "RGXM has cancelled the following. Sorry for the change, and thanks for your flexibility.",
          details: [
            ["Project", b.projectName],
            ["Shift", when(b)],
            ...(b.cancelReason ? ([["Reason", b.cancelReason]] as [string, string][]) : []),
          ],
          actionLabel: "Open your schedule",
          url: url("/portal/schedule"),
        }),
      },
    });
  },

  "booking.waitlisted": async (payload, eventId) => {
    const [b] = await loadBookings([payload.bookingId as string]);
    if (!b || b.status !== "waitlisted") return;
    const person = await staffRecipient(b.staffId);
    await notify({
      dedupeKey: `n:${eventId}`,
      userId: person.userId,
      type: "booking.waitlisted",
      title: `You're on the waitlist: ${b.projectName}`,
      body: `${roleName(b.role)} · ${when(b)}. We'll let you know if a spot opens up.`,
      href: "/portal/schedule",
      email: {
        to: person.email,
        subject: `Waitlist: ${b.projectName}, ${formatInZone(b.startsAt, b.timezone, "MMM d")}`,
        ...detailEmail({
          heading: `Thanks, ${person.name}`,
          intro: "This shift is full right now, so you're on the waitlist. If a spot opens, RGXM may confirm you. You'll get a separate confirmation if that happens.",
          details: [
            ["Project", b.projectName],
            ["Shift", when(b)],
          ],
          actionLabel: "Open your schedule",
          url: url("/portal/schedule"),
        }),
      },
    });
  },

  "shift.changed": async (payload, eventId) => {
    const ids = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.shiftId, payload.shiftId as string), inArray(bookings.status, ["offered", "interested", "awaiting_confirmation", "confirmed", "waitlisted"])));
    for (const b of await loadBookings(ids.map((x) => x.id))) {
      const person = await staffRecipient(b.staffId);
      const confirmed = b.status === "confirmed";
      await notify({
        dedupeKey: `n:${eventId}:${b.id}`,
        userId: person.userId,
        type: "shift.changed",
        title: `Shift updated: ${b.projectName}`,
        body: when(b),
        href: confirmed ? `/portal/shifts/${b.id}` : "/portal/opportunities",
        email: confirmed
          ? {
              to: person.email,
              subject: `Updated shift details: ${b.projectName}`,
              ...detailEmail({
                heading: `Hi ${person.name}, your shift details changed`,
                intro: "Please check the latest details below.",
                details: [
                  ["When", when(b)],
                  ["Where", b.locationName],
                  ...(b.reportingLocation ? ([["Report to", b.reportingLocation]] as [string, string][]) : []),
                  ...(b.uniform ? ([["Uniform", b.uniform]] as [string, string][]) : []),
                ],
                actionLabel: "View shift",
                url: url(`/portal/shifts/${b.id}`),
              }),
            }
          : undefined,
      });
    }
  },

  "shift.cancelled": async (payload, eventId) => {
    for (const b of await loadBookings(payload.bookingIds as string[])) {
      const person = await staffRecipient(b.staffId);
      await notify({
        dedupeKey: `n:${eventId}:${b.id}`,
        userId: person.userId,
        type: "shift.cancelled",
        title: `Shift cancelled: ${b.projectName}, ${formatInZone(b.startsAt, b.timezone, "MMM d")}`,
        body: b.cancelReason ?? undefined,
        href: "/portal/schedule",
        email: {
          to: person.email,
          subject: `Shift cancelled: ${b.projectName}, ${formatInZone(b.startsAt, b.timezone, "MMM d")}`,
          ...detailEmail({
            heading: `Hi ${person.name}`,
            intro: "This shift has been cancelled by RGXM.",
            details: [
              ["Project", b.projectName],
              ["Shift", when(b)],
              ...(b.cancelReason ? ([["Reason", b.cancelReason]] as [string, string][]) : []),
            ],
            actionLabel: "Open your schedule",
            url: url("/portal/schedule"),
          }),
        },
      });
    }
  },

  "announcement.posted": async (payload, eventId) => {
    const [a] = await db
      .select({ a: announcements, projectName: projects.name })
      .from(announcements)
      .innerJoin(projects, eq(projects.id, announcements.projectId))
      .where(eq(announcements.id, payload.announcementId as string));
    if (!a) return;
    const audience = await db
      .selectDistinct({ staffId: bookings.staffId })
      .from(bookings)
      .where(and(eq(bookings.projectId, a.a.projectId), eq(bookings.status, "confirmed"), gte(bookings.endsAt, new Date())));
    for (const { staffId } of audience) {
      const person = await staffRecipient(staffId);
      await notify({
        dedupeKey: `n:${eventId}:${staffId}`,
        userId: person.userId,
        type: "announcement",
        title: `${a.a.important ? "Important: " : ""}${a.a.title}`,
        body: a.projectName,
        href: "/portal/messages",
        email: a.a.important
          ? {
              to: person.email,
              subject: `${a.projectName}: ${a.a.title}`,
              ...detailEmail({ heading: a.a.title, intro: a.a.body, details: [["Project", a.projectName]], actionLabel: "Open messages", url: url("/portal/messages") }),
            }
          : undefined,
      });
    }
  },

  "document.published": async (payload, eventId) => {
    const [d] = await db
      .select({ d: documents, projectName: projects.name })
      .from(documents)
      .innerJoin(projects, eq(projects.id, documents.projectId))
      .where(eq(documents.id, payload.documentId as string));
    if (!d || d.d.archivedAt || d.d.version !== payload.version) return;
    const audience = await db
      .selectDistinct({ staffId: bookings.staffId })
      .from(bookings)
      .where(
        and(
          eq(bookings.projectId, d.d.projectId),
          eq(bookings.status, "confirmed"),
          gte(bookings.endsAt, new Date()),
          d.d.shiftId ? eq(bookings.shiftId, d.d.shiftId) : undefined,
        ),
      );
    for (const { staffId } of audience) {
      const person = await staffRecipient(staffId);
      const verb = payload.version === 1 ? "New" : "Updated";
      await notify({
        dedupeKey: `n:${eventId}:${staffId}`,
        userId: person.userId,
        type: "document",
        title: `${verb} ${d.d.requiresAck ? "brief to review" : "document"}: ${d.d.title}`,
        body: d.projectName,
        href: "/portal/schedule",
        email: d.d.requiresAck
          ? {
              to: person.email,
              subject: `Please review: ${d.d.title} (${d.projectName})`,
              ...detailEmail({
                heading: `${verb} briefing document`,
                intro: "Please read this before your shift and confirm you've reviewed it in the staff portal.",
                details: [
                  ["Project", d.projectName],
                  ["Document", d.d.title],
                ],
                actionLabel: "Review and acknowledge",
                url: url("/portal/schedule"),
              }),
            }
          : undefined,
      });
    }
  },

  "message.posted": async (payload, eventId) => {
    const [m] = await db
      .select({ body: messages.body, authorKind: users.kind, authorName: users.name, thread: messageThreads, projectName: projects.name })
      .from(messages)
      .innerJoin(users, eq(users.id, messages.authorId))
      .innerJoin(messageThreads, eq(messageThreads.id, messages.threadId))
      .leftJoin(projects, eq(projects.id, messageThreads.projectId))
      .where(eq(messages.id, payload.messageId as string));
    if (!m) return;
    const preview = m.body.length > 140 ? `${m.body.slice(0, 140)}…` : m.body;
    if (m.authorKind === "staff") {
      const team = m.thread.projectId ? await projectTeam(m.thread.projectId) : [];
      // General (no project) messages go to staffing coordinators.
      const recipients = team.length
        ? team
        : (await db.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.role, "staffing_coordinator"))).map((r) => r.userId);
      for (const userId of recipients) {
        await notify({
          dedupeKey: `n:${eventId}:${userId}`,
          userId,
          type: "message",
          title: `Message from ${m.authorName}${m.projectName ? ` · ${m.projectName}` : ""}`,
          body: preview,
          href: m.thread.projectId ? `/dashboard/staffing/${m.thread.projectId}?thread=${m.thread.id}` : "/dashboard/staffing",
        });
      }
      return;
    }
    const person = await staffRecipient(m.thread.staffId);
    await notify({
      dedupeKey: `n:${eventId}`,
      userId: person.userId,
      type: "message",
      title: `Message from RGXM${m.projectName ? ` · ${m.projectName}` : ""}`,
      body: preview,
      href: `/portal/messages/${m.thread.id}`,
      email: {
        to: person.email,
        subject: `New message from RGXM${m.projectName ? ` about ${m.projectName}` : ""}`,
        ...detailEmail({
          heading: `Hi ${person.name}, you have a new message`,
          intro: preview,
          details: m.projectName ? [["Project", m.projectName]] : [],
          actionLabel: "Read and reply",
          url: url(`/portal/messages/${m.thread.id}`),
        }),
      },
    });
  },
};
