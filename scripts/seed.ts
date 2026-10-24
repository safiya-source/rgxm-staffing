// Demo data for local development and staging. Every record is flagged is_demo and every
// email address uses the reserved .test domain, so nothing seeded can ever trigger a real
// message or payment (business rule 20).
//
//   npm run db:seed            # idempotent: skips if demo data already exists
//
import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { expandShiftPattern } from "../src/lib/time";
import { db } from "../src/server/db";
import { seedCompletedProject } from "./seed-completed";
import {
  accounts,
  availabilityExceptions,
  availabilityRules,
  shifts,
  certifications,
  clients,
  languages,
  projectLocations,
  projects,
  skills,
  staffCertifications,
  staffingRequirements,
  staffLanguages,
  staffListMembers,
  staffLists,
  staffProfiles,
  staffRates,
  staffRoles,
  staffSensitive,
  staffSkills,
  userRoles,
  users,
} from "../src/server/db/schema";

type FieldRole = "BA" | "TL" | "PA" | "AM";
type InternalRole = "admin" | "project_manager" | "staffing_coordinator" | "finance";

const DEMO_DOMAIN = "rgxm-demo.test";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "rgxm-demo-password";
const BASE_RATES: Record<FieldRole, number> = { BA: 2500, TL: 3000, PA: 2800, AM: 4000 };

// Deterministic pseudo-random so every seed produces the same people.
let state = 20261112;
const rand = () => {
  state = (state * 1103515245 + 12345) % 2 ** 31;
  return state / 2 ** 31;
};
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;

const FIRST = ["Aisha", "Ben", "Carmen", "Daniel", "Elena", "Farah", "Gabriel", "Hana", "Isaac", "Jasmine", "Kai", "Leila", "Marcus", "Nadia", "Omar", "Paige", "Quinn", "Rosa", "Samir", "Tara", "Uma", "Victor", "Wen", "Ximena", "Yusuf", "Zoe", "Amara", "Bruno", "Chloé", "Dev", "Esme", "Felix", "Grace", "Hugo", "Imani", "Jonah", "Kiara", "Liam", "Maya", "Noah", "Olivia", "Priyanka", "Rafael", "Sofia", "Theo", "Valentina", "Wyatt", "Yara", "Zain", "Anika", "Caleb", "Daria", "Emeka", "Fiona", "Gia", "Hamza", "Ines", "Jae", "Kofi", "Lucía"];
const LAST = ["Ahmed", "Bouchard", "Chen", "Desai", "Edwards", "Fernandes", "Gill", "Huang", "Ibrahim", "Johnson", "Khan", "Lam", "Martin", "Nguyen", "Okafor", "Patel", "Quintero", "Roy", "Singh", "Tremblay", "Usman", "Vasquez", "Wong", "Xu", "Yildiz", "Zhang", "Gagnon", "Morales", "Osei", "Reyes"];
const CITIES: [string, number][] = [["Toronto", 40], ["Mississauga", 6], ["Markham", 4], ["Brampton", 4], ["Vaughan", 3], ["Hamilton", 3]];
const LANGS = ["English", "French", "Mandarin", "Cantonese", "Punjabi", "Spanish", "Tagalog", "Arabic", "Portuguese"];
const SKILLS = ["Sampling", "Product demos", "Mixology", "Inventory management", "AV setup", "Social content capture", "MC / hosting", "Lead capture"];
const CERTS = ["Smart Serve", "Food Handler Certification", "Standard First Aid & CPR", "Working at Heights"];

async function main() {
  if (process.env.NODE_ENV === "production" && !process.argv.includes("--force")) {
    throw new Error("Refusing to seed demo data with NODE_ENV=production (pass --force for a staging environment).");
  }
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, `admin@${DEMO_DOMAIN}`));
  if (existing) {
    console.log("Demo data already present; nothing to do. (Use `npm run db:reset` for a clean database.)");
    return;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  await db.transaction(async (tx) => {
    // ─── Internal team ───
    const team: { name: string; email: string; roles: InternalRole[] }[] = [
      { name: "Alex Morgan", email: `admin@${DEMO_DOMAIN}`, roles: ["admin"] },
      { name: "Sam Rivera", email: `pm@${DEMO_DOMAIN}`, roles: ["project_manager"] },
      { name: "Taylor Brooks", email: `coordinator@${DEMO_DOMAIN}`, roles: ["staffing_coordinator"] },
      { name: "Jordan Ellis", email: `finance@${DEMO_DOMAIN}`, roles: ["finance"] },
      { name: "Casey Nakamura", email: `ops@${DEMO_DOMAIN}`, roles: ["project_manager", "staffing_coordinator"] },
    ];
    const internalIds: Record<string, string> = {};
    for (const member of team) {
      const [u] = await tx
        .insert(users)
        .values({ name: member.name, email: member.email, kind: "internal", emailVerified: true, isDemo: true })
        .returning({ id: users.id });
      internalIds[member.email.split("@")[0]!] = u!.id;
      await tx.insert(accounts).values({ userId: u!.id, accountId: u!.id, providerId: "credential", password: passwordHash });
      await tx.insert(userRoles).values(member.roles.map((role) => ({ userId: u!.id, role })));
    }

    // ─── Lookups ───
    const langRows = await tx.insert(languages).values(LANGS.map((name) => ({ name }))).returning();
    const skillRows = await tx.insert(skills).values(SKILLS.map((name) => ({ name }))).returning();
    const certRows = await tx.insert(certifications).values(CERTS.map((name) => ({ name }))).returning();
    const langId = (n: string) => langRows.find((l) => l.name === n)!.id;

    // ─── Field staff ───
    const cityPool = CITIES.flatMap(([city, n]) => Array<string>(n).fill(city));
    const staff: { id: string; roles: FieldRole[]; city: string; langs: string[] }[] = [];

    // Two demo staff with portal accounts (sign in with a magic link; the link appears in Settings → Mail log).
    const portalPeople = [
      { first: "Jordan", last: "Lee", email: `ba.demo@${DEMO_DOMAIN}`, roles: ["BA"] as FieldRole[] },
      { first: "Priya", last: "Shah", email: `tl.demo@${DEMO_DOMAIN}`, roles: ["TL", "BA"] as FieldRole[] },
    ];

    for (let i = 0; i < 60; i++) {
      const portal = portalPeople[i];
      const first = portal?.first ?? FIRST[i % FIRST.length]!;
      const last = portal?.last ?? pick(LAST);
      const email = portal?.email ?? `${first.normalize("NFD").replace(/[^a-zA-Z]/g, "").toLowerCase()}.${last.toLowerCase()}${i}@${DEMO_DOMAIN}`;
      const city = portal ? "Toronto" : cityPool[i % cityPool.length]!;

      let roles: FieldRole[] = portal?.roles ?? ["BA"];
      if (!portal) {
        if (i % 9 === 0) roles = ["TL", "BA"];
        else if (i % 11 === 0) roles = ["AM", "TL"];
        else if (i % 7 === 0) roles = ["PA"];
        else if (i % 13 === 0) roles = ["PA", "BA"];
      }
      const langs = ["English", ...(rand() < 0.3 ? ["French"] : []), ...(rand() < 0.35 ? [pick(LANGS.slice(2))] : [])];

      let userId: string | null = null;
      if (portal) {
        const [u] = await tx
          .insert(users)
          .values({ name: `${first} ${last}`, email, kind: "staff", emailVerified: true, isDemo: true })
          .returning({ id: users.id });
        userId = u!.id;
      }

      const [p] = await tx
        .insert(staffProfiles)
        .values({
          userId,
          firstName: first,
          lastName: last,
          email,
          phone: `416-555-${String(1000 + i).slice(-4)}`,
          city,
          province: "ON",
          serviceArea: city === "Toronto" ? "Toronto core" : "GTA",
          status: i === 58 ? "inactive" : i === 59 ? "suspended" : "active",
          experienceYears: Math.floor(rand() * 8),
          hasVehicle: rand() < 0.4,
          willingToTravel: rand() < 0.5,
          travelRadiusKm: pick([10, 25, 50, 100]),
          classification: i % 10 === 3 ? "employee" : i % 17 === 5 ? "unset" : "contractor",
          onboardingCompletedAt: new Date("2026-09-01T14:00:00Z"),
          isDemo: true,
        })
        .returning({ id: staffProfiles.id });
      const staffId = p!.id;
      staff.push({ id: staffId, roles, city, langs });

      await tx.insert(staffSensitive).values({ staffId, taxRegistered: i % 6 === 0 });
      await tx.insert(staffRoles).values(roles.map((role) => ({ staffId, role })));
      await tx.insert(staffRates).values(
        roles.map((role) => ({
          staffId,
          role,
          rateCents: BASE_RATES[role] + (i % 4 === 0 ? 200 : 0),
          effectiveFrom: new Date("2026-01-01T05:00:00Z"),
          note: "Demo rate",
        })),
      );
      await tx.insert(staffLanguages).values(langs.map((l) => ({ staffId, languageId: langId(l) })));
      const mySkills = new Set([pick(skillRows).id, pick(skillRows).id]);
      await tx.insert(staffSkills).values([...mySkills].map((skillId) => ({ staffId, skillId })));
      if (rand() < 0.45) {
        await tx.insert(staffCertifications).values({
          staffId,
          certificationId: pick(certRows).id,
          issuedOn: "2025-03-01",
          expiresOn: rand() < 0.2 ? "2026-12-31" : "2028-03-01",
        });
      }
    }

    // ─── Availability (weekly patterns; most people free on weekends/evenings) ───
    for (const [i, person] of staff.entries()) {
      if (i % 5 === 4) continue; // some people haven't set availability
      const days = i % 3 === 0 ? [0, 4, 5, 6] : i % 3 === 1 ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6];
      await tx.insert(availabilityRules).values(days.map((weekday) => ({ staffId: person.id, weekday, startTime: "08:00", endTime: "22:00" })));
    }
    await tx.insert(availabilityExceptions).values({ staffId: staff[2]!.id, date: "2026-11-13", kind: "unavailable", note: "Exam" });

    // ─── Saved lists ───
    const lists: [string, string, (s: (typeof staff)[number]) => boolean][] = [
      ["Toronto Preferred BAs", "Reliable Toronto brand ambassadors", (s) => s.city === "Toronto" && s.roles.includes("BA")],
      ["Experienced Team Leads", "", (s) => s.roles.includes("TL")],
      ["Production Crew", "", (s) => s.roles.includes("PA")],
      ["Bilingual Staff", "English + French", (s) => s.langs.includes("French")],
      ["Preferred Activation Managers", "", (s) => s.roles.includes("AM")],
    ];
    for (const [name, description, filter] of lists) {
      const [list] = await tx
        .insert(staffLists)
        .values({ name, description: description || null, createdBy: internalIds.coordinator })
        .returning({ id: staffLists.id });
      const members = staff.filter(filter).slice(0, 25);
      if (members.length) {
        await tx.insert(staffListMembers).values(members.map((m) => ({ listId: list!.id, staffId: m.id, addedBy: internalIds.coordinator })));
      }
    }

    // ─── Clients & projects ───
    const [cadbury] = await tx.insert(clients).values({ name: "Cadbury (demo)", isDemo: true }).returning({ id: clients.id });
    const [tacoBell] = await tx.insert(clients).values({ name: "Taco Bell (demo)", isDemo: true }).returning({ id: clients.id });

    const [cad] = await tx
      .insert(projects)
      .values({
        code: "DEMO-CAD-2611",
        name: "Cadbury Sampling Activation",
        clientId: cadbury!.id,
        campaignName: "Holiday sampling",
        description: "Four-day sampling activation at CF Toronto Eaton Centre (acceptance-test scenario).",
        ownerId: internalIds.pm,
        coordinatorId: internalIds.coordinator,
        startDate: "2026-11-12",
        endDate: "2026-11-15",
        status: "staffing",
        budgetCents: 1_500_000,
        isDemo: true,
        createdBy: internalIds.pm,
      })
      .returning({ id: projects.id });
    const [eaton] = await tx
      .insert(projectLocations)
      .values({
        projectId: cad!.id,
        name: "Toronto Eaton Centre",
        address: "220 Yonge St, Toronto, ON M5B 2H1",
        city: "Toronto",
        province: "ON",
        timezone: "America/Toronto",
        latitude: 43.6544,
        longitude: -79.3807,
        geofenceMeters: 300,
        onsiteContactName: "Sam Rivera",
      })
      .returning({ id: projectLocations.id });
    const cadReqs: [FieldRole, number][] = [["BA", 10], ["TL", 2], ["PA", 2], ["AM", 1]];
    await tx.insert(staffingRequirements).values(
      cadReqs.map(([role, quantity]) => ({
        projectId: cad!.id,
        locationId: eaton!.id,
        role,
        quantity,
        defaultRateCents: BASE_RATES[role],
        startDate: "2026-11-12",
        endDate: "2026-11-15",
      })),
    );

    // Cadbury shifts: one shift per role per day, Nov 12–15 (Toronto time).
    const cadShifts: [FieldRole, number, string, string][] = [
      ["BA", 10, "10:00", "18:00"],
      ["TL", 2, "09:30", "18:30"],
      ["PA", 2, "08:00", "17:00"],
      ["AM", 1, "09:00", "19:00"],
    ];
    for (const [role, headcount, startTime, endTime] of cadShifts) {
      const windows = expandShiftPattern({ startDate: "2026-11-12", endDate: "2026-11-15", weekdays: [], startTime, endTime, timeZone: "America/Toronto" });
      await tx.insert(shifts).values(
        windows.map((w) => ({
          projectId: cad!.id,
          locationId: eaton!.id,
          role,
          startsAt: w.startsAt,
          endsAt: w.endsAt,
          timezone: "America/Toronto",
          headcount,
          rateCents: BASE_RATES[role],
          reportingLocation: "Staff entrance off Queen St, Level 1",
          onsiteContact: "Sam Rivera",
          uniform: "Black pants, black closed-toe shoes. Branded purple shirt provided on site.",
          instructions: "Check in with the Team Lead 15 minutes before your shift.",
          status: "open" as const,
          createdBy: internalIds.pm,
        })),
      );
    }

    const [tb] = await tx
      .insert(projects)
      .values({
        code: "DEMO-TB-2612",
        name: "Taco Bell — Diablo Maple Activation",
        clientId: tacoBell!.id,
        description: "Two-location pop-up in Toronto.",
        ownerId: internalIds.ops,
        coordinatorId: internalIds.ops,
        startDate: "2026-12-04",
        endDate: "2026-12-06",
        status: "draft",
        budgetCents: 1_200_000,
        isDemo: true,
        createdBy: internalIds.ops,
      })
      .returning({ id: projects.id });
    const tbLocations = await tx
      .insert(projectLocations)
      .values([
        { projectId: tb!.id, name: "Toronto — Location A (Queen West)", city: "Toronto", province: "ON", timezone: "America/Toronto" },
        { projectId: tb!.id, name: "Toronto — Location B (Yorkdale)", city: "Toronto", province: "ON", timezone: "America/Toronto" },
      ])
      .returning({ id: projectLocations.id });
    const tbReqs: [FieldRole, number, number][] = [["BA", 4, 0], ["BA", 4, 1], ["TL", 1, 0], ["TL", 1, 1], ["PA", 2, 0], ["AM", 1, 0]];
    await tx.insert(staffingRequirements).values(
      tbReqs.map(([role, quantity, loc]) => ({
        projectId: tb!.id,
        locationId: tbLocations[loc]!.id,
        role,
        quantity,
        defaultRateCents: BASE_RATES[role],
      })),
    );
  });

  const payables = await seedCompletedProject(DEMO_DOMAIN);

  console.log(`Demo data seeded (${payables} approved demo payables on the finished Oreo project).
  Team sign-in (password: ${DEMO_PASSWORD}):
    admin@${DEMO_DOMAIN}        System Administrator
    pm@${DEMO_DOMAIN}           Project Manager
    coordinator@${DEMO_DOMAIN}  Staffing Coordinator
    finance@${DEMO_DOMAIN}      Finance
    ops@${DEMO_DOMAIN}          Project Manager + Staffing Coordinator
  Staff portal (magic link; find the link in Settings → Mail log as admin):
    ba.demo@${DEMO_DOMAIN}      Brand Ambassador
    tl.demo@${DEMO_DOMAIN}      Team Lead`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
