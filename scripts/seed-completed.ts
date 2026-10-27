// A finished demo activation with approved hours, so Payments and Budget have something to show.
// Goes through the real domain functions (adjust → approve), so payables are created exactly as in
// production: at the agreed rate, with each person's classification. Everything is demo data;
// exports of demo batches are marked "DEMO - DO NOT PAY".
import { and, eq, notInArray, sql } from "drizzle-orm";
import { expandShiftPattern } from "../src/lib/time";
import { db } from "../src/server/db";
import { bookings, clients, projectLocations, projects, shifts, staffProfiles, staffRoles, users } from "../src/server/db/schema";
import { approveTimesheet, ensureTimesheet, rgxmAdjust } from "../src/server/domain/attendance";

export async function seedCompletedProject(domain: string) {
  const [pm] = await db.select({ id: users.id }).from(users).where(eq(users.email, `pm@${domain}`));
  const [ops] = await db.select({ id: users.id }).from(users).where(eq(users.email, `ops@${domain}`));
  const [client] = await db.insert(clients).values({ name: "Oreo (demo)", isDemo: true }).returning({ id: clients.id });
  const [project] = await db
    .insert(projects)
    .values({
      code: "DEMO-ORE-2610",
      name: "Oreo Cookie Truck",
      clientId: client!.id,
      description: "Two-day sampling truck at Union Station. Finished; hours approved and waiting for payment.",
      ownerId: pm!.id,
      coordinatorId: ops!.id,
      startDate: "2026-10-10",
      endDate: "2026-10-11",
      status: "completed",
      budgetCents: 300_000,
      isDemo: true,
      createdBy: pm!.id,
    })
    .returning({ id: projects.id });
  const [loc] = await db
    .insert(projectLocations)
    .values({ projectId: project!.id, name: "Union Station — Front St concourse", address: "65 Front St W, Toronto, ON", city: "Toronto", province: "ON", timezone: "America/Toronto" })
    .returning({ id: projectLocations.id });

  // Brand Ambassadors with a mix of pay classifications (including one not set yet).
  const pickBy = async (classification: "contractor" | "employee" | "unset", n: number, exclude: string[] = []) =>
    db
      .select({ id: staffProfiles.id })
      .from(staffProfiles)
      .innerJoin(staffRoles, and(eq(staffRoles.staffId, staffProfiles.id), eq(staffRoles.role, "BA")))
      .where(and(eq(staffProfiles.isDemo, true), eq(staffProfiles.classification, classification), exclude.length ? notInArray(staffProfiles.id, exclude) : undefined))
      .orderBy(staffProfiles.lastName)
      .limit(n);
  const [jordan] = await db.select({ id: staffProfiles.id }).from(staffProfiles).where(eq(staffProfiles.email, `ba.demo@${domain}`));
  const people = [jordan!, ...(await pickBy("contractor", 2, [jordan!.id])), ...(await pickBy("employee", 1)), ...(await pickBy("unset", 1))];

  const windows = expandShiftPattern({ startDate: "2026-10-10", endDate: "2026-10-11", weekdays: [], startTime: "11:00", endTime: "17:00", timeZone: "America/Toronto" });
  for (const w of windows) {
    if (w.endsAt > new Date()) continue; // only seed shifts that have already happened
    const [s] = await db
      .insert(shifts)
      .values({ projectId: project!.id, locationId: loc!.id, role: "BA", startsAt: w.startsAt, endsAt: w.endsAt, timezone: "America/Toronto", headcount: people.length, rateCents: 2400, status: "completed", createdBy: pm!.id })
      .returning({ id: shifts.id });
    const booked = await db
      .insert(bookings)
      .values(people.map((p) => ({ shiftId: s!.id, staffId: p.id, projectId: project!.id, role: "BA" as const, startsAt: w.startsAt, endsAt: w.endsAt, status: "confirmed" as const, offeredRateCents: 2400, agreedRateCents: 2400, rateSource: "shift", confirmedAt: new Date("2026-10-01T15:00:00Z"), confirmedBy: ops!.id })))
      .returning({ id: bookings.id });
    for (const [i, b] of booked.entries()) {
      const t = await ensureTimesheet(db, b.id);
      // Most worked the full shift with a 30-minute break; one left an hour early.
      const end = i === 2 ? new Date(w.endsAt.getTime() - 60 * 60_000) : w.endsAt;
      await rgxmAdjust(ops!.id, t.id, { workedStart: w.startsAt, workedEnd: end, breakMinutes: 30 }, "From the signed paper timesheet (demo)");
      await approveTimesheet(pm!.id, t.id);
    }
  }
  const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int n from payable_items where project_id = ${project!.id}`)).rows as [{ n: number }];
  return n;
}

