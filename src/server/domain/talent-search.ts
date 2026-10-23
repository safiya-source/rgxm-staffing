// Talent directory query. Filters are objective criteria only (no rankings, no protected characteristics).
import { and, asc, count, eq, exists, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { isIsoDate, localDayBounds } from "@/lib/time";
import { FIELD_ROLES } from "@/lib/roles";
import { db } from "@/server/db";
import {
  availabilityExceptions,
  availabilityRules,
  bookings,
  staffCertifications,
  staffLanguages,
  staffListMembers,
  staffProfiles,
  staffRates,
  staffRoles,
  staffSkills,
} from "@/server/db/schema";

const csvList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : (Array.isArray(v) ? v : v.split(","))).map((s) => s.trim()).filter(Boolean));
const uuidList = csvList.pipe(z.array(z.string().uuid()));
const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v && isIsoDate(v) ? v : undefined));
const optionalInt = z.coerce.number().int().nonnegative().optional().catch(undefined);

export const talentFilterSchema = z.object({
  q: z.string().trim().max(80).optional().catch(undefined),
  city: csvList,
  role: z.enum(FIELD_ROLES).optional().catch(undefined),
  status: z.enum(["active", "inactive", "suspended", "archived", "any"]).default("active").catch("active"),
  skills: uuidList.catch([]),
  languages: uuidList.catch([]),
  certs: uuidList.catch([]),
  list: z.string().uuid().optional().catch(undefined),
  project: z.string().uuid().optional().catch(undefined),
  availableOn: optionalDate,
  noConflicts: z
    .enum(["1", "true"])
    .optional()
    .transform((v) => Boolean(v))
    .catch(false),
  minRate: optionalInt, // cents/hour
  maxRate: optionalInt,
  minExperience: optionalInt,
  vehicle: z
    .enum(["1", "true"])
    .optional()
    .transform((v) => Boolean(v))
    .catch(false),
  page: z.coerce.number().int().min(1).default(1).catch(1),
});

export type TalentFilters = z.infer<typeof talentFilterSchema>;

export function parseTalentFilters(params: Record<string, string | string[] | undefined>): TalentFilters {
  return talentFilterSchema.parse(params);
}

export const PAGE_SIZE = 50;

/** Builds the WHERE clause. `canFilterRates` must be false for users who can't see rates. */
export function talentWhere(f: TalentFilters, opts: { canFilterRates: boolean; timeZone: string }): SQL | undefined {
  const conds: SQL[] = [];
  const p = staffProfiles;

  if (f.status !== "any") conds.push(eq(p.status, f.status));
  if (f.q) {
    const pattern = `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(
      or(
        ilike(sql`${p.firstName} || ' ' || ${p.lastName}`, pattern),
        ilike(p.preferredName, pattern),
        ilike(p.email, pattern),
        ilike(p.phone, pattern),
      )!,
    );
  }
  if (f.city.length) conds.push(inArray(sql`lower(${p.city})`, f.city.map((c) => c.toLowerCase())));
  if (f.role) {
    conds.push(exists(db.select({ x: sql`1` }).from(staffRoles).where(and(eq(staffRoles.staffId, p.id), eq(staffRoles.role, f.role)))));
  }
  for (const skillId of f.skills) {
    conds.push(exists(db.select({ x: sql`1` }).from(staffSkills).where(and(eq(staffSkills.staffId, p.id), eq(staffSkills.skillId, skillId)))));
  }
  for (const languageId of f.languages) {
    conds.push(
      exists(db.select({ x: sql`1` }).from(staffLanguages).where(and(eq(staffLanguages.staffId, p.id), eq(staffLanguages.languageId, languageId)))),
    );
  }
  for (const certId of f.certs) {
    // Only certifications that haven't expired count.
    conds.push(
      exists(
        db
          .select({ x: sql`1` })
          .from(staffCertifications)
          .where(
            and(
              eq(staffCertifications.staffId, p.id),
              eq(staffCertifications.certificationId, certId),
              or(isNull(staffCertifications.expiresOn), gte(staffCertifications.expiresOn, sql`current_date`)),
            ),
          ),
      ),
    );
  }
  if (f.list) {
    conds.push(
      exists(db.select({ x: sql`1` }).from(staffListMembers).where(and(eq(staffListMembers.staffId, p.id), eq(staffListMembers.listId, f.list)))),
    );
  }
  if (f.project) {
    conds.push(
      exists(
        db
          .select({ x: sql`1` })
          .from(bookings)
          .where(and(eq(bookings.staffId, p.id), eq(bookings.projectId, f.project), inArray(bookings.status, ["confirmed", "completed"]))),
      ),
    );
  }
  if (f.minExperience !== undefined) conds.push(gte(p.experienceYears, f.minExperience));
  if (f.vehicle) conds.push(eq(p.hasVehicle, true));

  if (opts.canFilterRates && (f.minRate !== undefined || f.maxRate !== undefined)) {
    const rateConds: SQL[] = [eq(staffRates.staffId, p.id), isNull(staffRates.effectiveTo)];
    if (f.role) rateConds.push(eq(staffRates.role, f.role));
    if (f.minRate !== undefined) rateConds.push(gte(staffRates.rateCents, f.minRate));
    if (f.maxRate !== undefined) rateConds.push(lte(staffRates.rateCents, f.maxRate));
    conds.push(exists(db.select({ x: sql`1` }).from(staffRates).where(and(...rateConds))));
  }

  if (f.availableOn) {
    const date = f.availableOn;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    // Declared available that day (exception or weekly pattern) and not marked unavailable.
    conds.push(
      sql`not exists (select 1 from ${availabilityExceptions} e where e.staff_id = ${p.id} and e.date = ${date} and e.kind = 'unavailable' and e.start_time is null)`,
    );
    conds.push(
      or(
        exists(
          db
            .select({ x: sql`1` })
            .from(availabilityExceptions)
            .where(and(eq(availabilityExceptions.staffId, p.id), eq(availabilityExceptions.date, date), eq(availabilityExceptions.kind, "available"))),
        ),
        exists(
          db
            .select({ x: sql`1` })
            .from(availabilityRules)
            .where(and(eq(availabilityRules.staffId, p.id), eq(availabilityRules.weekday, weekday))),
        ),
      )!,
    );
  }
  if (f.availableOn && f.noConflicts) {
    const [start, end] = localDayBounds(f.availableOn, opts.timeZone);
    conds.push(
      sql`not exists (select 1 from ${bookings} b where b.staff_id = ${p.id} and b.status in ('confirmed', 'completed')
          and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, '[)'))`,
    );
  }

  return conds.length ? and(...conds) : undefined;
}

export async function searchTalent(f: TalentFilters, opts: { canSeeRates: boolean; timeZone: string; limit?: number }) {
  const where = talentWhere(f, { canFilterRates: opts.canSeeRates, timeZone: opts.timeZone });
  const limit = opts.limit ?? PAGE_SIZE;
  const p = staffProfiles;

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        preferredName: p.preferredName,
        email: p.email,
        phone: p.phone,
        city: p.city,
        province: p.province,
        status: p.status,
        experienceYears: p.experienceYears,
        classification: p.classification,
        isDemo: p.isDemo,
        hasAccount: sql<boolean>`${p.userId} is not null`,
        roles: sql<string[]>`coalesce((select array_agg(r.role::text order by r.role) from ${staffRoles} r where r.staff_id = ${p.id}), '{}')`,
        completedShifts: sql<number>`(select count(*)::int from ${bookings} b where b.staff_id = ${p.id} and b.status = 'completed')`,
        lastShiftAt: sql<Date | null>`(select max(b.starts_at) from ${bookings} b where b.staff_id = ${p.id} and b.status = 'completed')`,
      })
      .from(p)
      .where(where)
      .orderBy(asc(p.lastName), asc(p.firstName), asc(p.id))
      .limit(limit)
      .offset((f.page - 1) * limit),
    db.select({ n: count() }).from(p).where(where),
  ]);

  let rates = new Map<string, { role: string; rateCents: number }[]>();
  if (opts.canSeeRates && rows.length) {
    const r = await db
      .select({ staffId: staffRates.staffId, role: staffRates.role, rateCents: staffRates.rateCents })
      .from(staffRates)
      .where(and(inArray(staffRates.staffId, rows.map((x) => x.id)), isNull(staffRates.effectiveTo)));
    rates = r.reduce((m, x) => m.set(x.staffId, [...(m.get(x.staffId) ?? []), x]), new Map<string, { role: string; rateCents: number }[]>());
  }

  return {
    total: total?.n ?? 0,
    rows: rows.map((r) => ({ ...r, rates: rates.get(r.id) ?? [] })),
  };
}

export type TalentRow = Awaited<ReturnType<typeof searchTalent>>["rows"][number];
