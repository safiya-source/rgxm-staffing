// Talent database operations. Callers (server actions) handle authorisation; every write here
// is audited in the same transaction.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { parseCsv } from "@/lib/csv";
import { PROVINCE_CODES } from "@/lib/provinces";
import { FIELD_ROLES, type FieldRole } from "@/lib/roles";
import { recordAudit } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import {
  certifications,
  internalNotes,
  languages,
  skills,
  staffCertifications,
  staffLanguages,
  staffListMembers,
  staffLists,
  staffProfiles,
  staffRates,
  staffRoles,
  staffSensitive,
  staffSkills,
} from "@/server/db/schema";

export class TalentError extends Error {}

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const optText = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());
const optInt = (min: number, max: number) => z.preprocess(blankToNull, z.coerce.number().int().min(min).max(max).nullable().optional());
const optBool = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? null : v === true || v === "true" || v === "on" || v === "yes" || v === "1"),
  z.boolean().nullable().optional(),
);

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()\-.]{10,20}$/, "Enter a valid phone number");

export const staffProfileSchema = z.object({
  firstName: z.string().trim().min(1, "Required").max(60),
  lastName: z.string().trim().min(1, "Required").max(60),
  preferredName: optText(60),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  phone: z.preprocess(blankToNull, phoneSchema.nullable().optional()),
  city: optText(80),
  province: z.preprocess(blankToNull, z.enum(PROVINCE_CODES).nullable().optional()),
  serviceArea: optText(120),
  experienceYears: optInt(0, 60),
  experienceSummary: optText(2000),
  hasDriversLicence: optBool,
  hasVehicle: optBool,
  willingToTravel: optBool,
  travelRadiusKm: optInt(0, 5000),
  preferredHours: optText(200),
});
export type StaffProfileInput = z.infer<typeof staffProfileSchema>;

async function assertEmailFree(tx: Tx, email: string, exceptId?: string) {
  const [row] = await tx
    .select({ id: staffProfiles.id })
    .from(staffProfiles)
    .where(eq(sql`lower(${staffProfiles.email})`, email.toLowerCase()));
  if (row && row.id !== exceptId) throw new TalentError("Another staff profile already uses that email.");
}

export async function createStaff(actorId: string, input: StaffProfileInput, roles: FieldRole[]) {
  return db.transaction(async (tx) => {
    await assertEmailFree(tx, input.email);
    const [created] = await tx.insert(staffProfiles).values(input).returning({ id: staffProfiles.id });
    const id = created!.id;
    await tx.insert(staffSensitive).values({ staffId: id });
    if (roles.length) await tx.insert(staffRoles).values(roles.map((role) => ({ staffId: id, role, verifiedBy: actorId })));
    await recordAudit({ actorId, action: "staff.create", entityType: "staff_profile", entityId: id, after: { ...input, roles } }, tx);
    return id;
  });
}

export async function updateStaff(actorId: string, staffId: string, input: StaffProfileInput) {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(staffProfiles).where(eq(staffProfiles.id, staffId));
    if (!before) throw new TalentError("Staff profile not found.");
    // The email of someone who has signed in is their login; they change it themselves.
    if (before.userId && before.email.toLowerCase() !== input.email.toLowerCase()) {
      throw new TalentError("This person signs in with their email, so it can't be changed here.");
    }
    await assertEmailFree(tx, input.email, staffId);
    await tx.update(staffProfiles).set(input).where(eq(staffProfiles.id, staffId));
    await recordAudit({ actorId, action: "staff.update", entityType: "staff_profile", entityId: staffId, before, after: input }, tx);
  });
}

export async function setStaffStatus(actorId: string, staffId: string, status: "active" | "inactive" | "suspended" | "archived", reason: string | null) {
  await db.transaction(async (tx) => {
    const [before] = await tx.select({ status: staffProfiles.status }).from(staffProfiles).where(eq(staffProfiles.id, staffId));
    if (!before) throw new TalentError("Staff profile not found.");
    if (before.status === status) return;
    await tx.update(staffProfiles).set({ status }).where(eq(staffProfiles.id, staffId));
    await recordAudit({ actorId, action: "staff.status", entityType: "staff_profile", entityId: staffId, before, after: { status }, reason }, tx);
  });
}

export async function setStaffRoles(actorId: string, staffId: string, roles: FieldRole[]) {
  await db.transaction(async (tx) => {
    const current = (await tx.select({ role: staffRoles.role }).from(staffRoles).where(eq(staffRoles.staffId, staffId))).map((r) => r.role);
    const add = roles.filter((r) => !current.includes(r));
    const remove = current.filter((r) => !roles.includes(r));
    if (remove.length) await tx.delete(staffRoles).where(and(eq(staffRoles.staffId, staffId), inArray(staffRoles.role, remove)));
    if (add.length) await tx.insert(staffRoles).values(add.map((role) => ({ staffId, role, verifiedBy: actorId })));
    await recordAudit({ actorId, action: "staff.roles", entityType: "staff_profile", entityId: staffId, before: current, after: roles }, tx);
  });
}

export async function setStaffTags(actorId: string, staffId: string, skillIds: string[], languageIds: string[]) {
  await db.transaction(async (tx) => {
    await tx.delete(staffSkills).where(eq(staffSkills.staffId, staffId));
    await tx.delete(staffLanguages).where(eq(staffLanguages.staffId, staffId));
    if (skillIds.length) await tx.insert(staffSkills).values([...new Set(skillIds)].map((skillId) => ({ staffId, skillId })));
    if (languageIds.length) await tx.insert(staffLanguages).values([...new Set(languageIds)].map((languageId) => ({ staffId, languageId })));
    await recordAudit({ actorId, action: "staff.tags", entityType: "staff_profile", entityId: staffId, after: { skillIds, languageIds } }, tx);
  });
}

export async function addCertification(actorId: string, staffId: string, input: { certificationId: string; issuedOn: string | null; expiresOn: string | null }) {
  await db.transaction(async (tx) => {
    const [row] = await tx.insert(staffCertifications).values({ staffId, ...input }).returning({ id: staffCertifications.id });
    await recordAudit({ actorId, action: "staff.certification_add", entityType: "staff_profile", entityId: staffId, after: { id: row!.id, ...input } }, tx);
  });
}

export async function removeCertification(actorId: string, staffId: string, staffCertificationId: string) {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .delete(staffCertifications)
      .where(and(eq(staffCertifications.id, staffCertificationId), eq(staffCertifications.staffId, staffId)))
      .returning();
    await recordAudit({ actorId, action: "staff.certification_remove", entityType: "staff_profile", entityId: staffId, before }, tx);
  });
}

/**
 * Sets a new default rate for a role. The current rate row is closed and a new one opened,
 * so history is preserved; bookings keep the rate snapshotted when they were confirmed.
 */
export async function setStaffRate(actorId: string, staffId: string, role: FieldRole, rateCents: number, note: string | null, tx?: Tx) {
  if (!Number.isInteger(rateCents) || rateCents < 0 || rateCents > 100_000) throw new TalentError("Enter a valid hourly rate.");
  const run = async (t: Tx) => {
    const now = new Date();
    const [current] = await t
      .select()
      .from(staffRates)
      .where(and(eq(staffRates.staffId, staffId), eq(staffRates.role, role), isNull(staffRates.effectiveTo)));
    if (current?.rateCents === rateCents) return;
    if (current) await t.update(staffRates).set({ effectiveTo: now }).where(eq(staffRates.id, current.id));
    await t.insert(staffRates).values({ staffId, role, rateCents, effectiveFrom: now, setBy: actorId, note });
    await recordAudit(
      { actorId, action: "staff.rate", entityType: "staff_profile", entityId: staffId, before: current ?? null, after: { role, rateCents }, reason: note },
      t,
    );
  };
  return tx ? run(tx) : db.transaction(run);
}

export async function setClassification(
  actorId: string,
  staffId: string,
  input: { classification: "unset" | "contractor" | "employee"; taxRegistered: boolean; gstHstNumber: string | null; legalName: string | null; businessName: string | null },
) {
  if (input.taxRegistered && !input.gstHstNumber) throw new TalentError("Enter the GST/HST number for a tax-registered contractor.");
  if (input.gstHstNumber && !/^\d{9}\s?RT\s?\d{4}$/i.test(input.gstHstNumber.trim())) {
    throw new TalentError("GST/HST numbers look like 123456789 RT0001.");
  }
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ classification: staffProfiles.classification })
      .from(staffProfiles)
      .where(eq(staffProfiles.id, staffId));
    await tx.update(staffProfiles).set({ classification: input.classification }).where(eq(staffProfiles.id, staffId));
    const sensitive = {
      taxRegistered: input.taxRegistered,
      gstHstNumber: input.gstHstNumber,
      legalName: input.legalName,
      businessName: input.businessName,
    };
    await tx
      .insert(staffSensitive)
      .values({ staffId, ...sensitive })
      .onConflictDoUpdate({ target: staffSensitive.staffId, set: sensitive });
    // Tax numbers are not copied into the audit log.
    await recordAudit(
      {
        actorId,
        action: "staff.classification",
        entityType: "staff_profile",
        entityId: staffId,
        before,
        after: { classification: input.classification, taxRegistered: input.taxRegistered },
      },
      tx,
    );
  });
}

export async function setEmergencyContact(actorId: string, staffId: string, input: { name: string | null; phone: string | null; relation: string | null }) {
  await db.transaction(async (tx) => {
    const values = { emergencyContactName: input.name, emergencyContactPhone: input.phone, emergencyContactRelation: input.relation };
    await tx.insert(staffSensitive).values({ staffId, ...values }).onConflictDoUpdate({ target: staffSensitive.staffId, set: values });
    await recordAudit({ actorId, action: "staff.emergency_contact", entityType: "staff_profile", entityId: staffId }, tx);
  });
}

export async function addInternalNote(actorId: string, staffId: string, body: string) {
  const text = body.trim();
  if (!text) throw new TalentError("Write a note first.");
  if (text.length > 4000) throw new TalentError("Notes are limited to 4,000 characters.");
  await db.transaction(async (tx) => {
    const [row] = await tx.insert(internalNotes).values({ staffId, authorId: actorId, body: text }).returning({ id: internalNotes.id });
    await recordAudit({ actorId, action: "staff.note_add", entityType: "staff_profile", entityId: staffId, after: { noteId: row!.id } }, tx);
  });
}

// ─── Saved lists ────────────────────────────────────────────────────────────

export async function createList(actorId: string, name: string, description: string | null) {
  const clean = name.trim();
  if (!clean || clean.length > 80) throw new TalentError("List names must be 1–80 characters.");
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(staffLists).values({ name: clean, description, createdBy: actorId }).returning({ id: staffLists.id });
    await recordAudit({ actorId, action: "list.create", entityType: "staff_list", entityId: row!.id, after: { name: clean } }, tx);
    return row!.id;
  });
}

export async function deleteList(actorId: string, listId: string) {
  await db.transaction(async (tx) => {
    const [before] = await tx.delete(staffLists).where(eq(staffLists.id, listId)).returning();
    if (!before) throw new TalentError("List not found.");
    await recordAudit({ actorId, action: "list.delete", entityType: "staff_list", entityId: listId, before }, tx);
  });
}

export async function addToList(actorId: string, listId: string, staffIds: string[]) {
  if (!staffIds.length) return 0;
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(staffListMembers)
      .values([...new Set(staffIds)].map((staffId) => ({ listId, staffId, addedBy: actorId })))
      .onConflictDoNothing()
      .returning({ staffId: staffListMembers.staffId });
    await recordAudit({ actorId, action: "list.add", entityType: "staff_list", entityId: listId, after: { added: inserted.length } }, tx);
    return inserted.length;
  });
}

export async function removeFromList(actorId: string, listId: string, staffIds: string[]) {
  await db.transaction(async (tx) => {
    await tx.delete(staffListMembers).where(and(eq(staffListMembers.listId, listId), inArray(staffListMembers.staffId, staffIds)));
    await recordAudit({ actorId, action: "list.remove", entityType: "staff_list", entityId: listId, after: { removed: staffIds } }, tx);
  });
}

// ─── CSV import ─────────────────────────────────────────────────────────────

export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_COLUMNS = [
  "first_name",
  "last_name",
  "preferred_name",
  "email",
  "phone",
  "city",
  "province",
  "roles",
  "languages",
  "skills",
  "experience_years",
  "ba_rate",
  "tl_rate",
  "pa_rate",
  "am_rate",
] as const;

const RATE_COLUMNS: Record<string, FieldRole> = { ba_rate: "BA", tl_rate: "TL", pa_rate: "PA", am_rate: "AM" };

const splitList = (v: string | undefined) =>
  (v ?? "")
    .split(/[|;,]/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Dollars ("25", "25.50", "$25") → cents. Rejects floats beyond 2 decimals. */
export function parseDollarsToCents(v: string): number | null {
  const clean = v.replace(/[$\s,]/g, "");
  if (!clean) return null;
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(clean)) return NaN;
  const [whole, frac = ""] = clean.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export type ImportRowResult = {
  line: number;
  email: string;
  action: "create" | "update" | "error";
  errors: string[];
  data?: { profile: StaffProfileInput; roles: FieldRole[]; languages: string[]; skills: string[]; rates: Partial<Record<FieldRole, number>> };
};

/** Validates a CSV without writing anything. Rate columns are ignored unless the importer may edit rates. */
export async function previewImport(csvText: string, opts: { canEditRates: boolean }) {
  const { rows, headers, errors } = parseCsv(csvText);
  if (errors.length && !rows.length) throw new TalentError("That file couldn't be read as CSV.");
  for (const required of ["first_name", "last_name", "email"]) {
    if (!headers.includes(required)) throw new TalentError(`Missing required column "${required}".`);
  }
  if (rows.length > IMPORT_MAX_ROWS) throw new TalentError(`Import at most ${IMPORT_MAX_ROWS} rows at a time.`);

  const emails = rows.map((r) => (r.email ?? "").toLowerCase()).filter(Boolean);
  const existing = new Set(
    emails.length
      ? (
          await db
            .select({ email: sql<string>`lower(${staffProfiles.email})` })
            .from(staffProfiles)
            .where(inArray(sql`lower(${staffProfiles.email})`, emails))
        ).map((r) => r.email)
      : [],
  );
  const seen = new Set<string>();

  const results: ImportRowResult[] = rows.map((row, i) => {
    const line = i + 2; // header is line 1
    const rowErrors: string[] = [];
    const email = (row.email ?? "").toLowerCase();
    const parsed = staffProfileSchema.safeParse({
      firstName: row.first_name,
      lastName: row.last_name,
      preferredName: row.preferred_name,
      email: row.email,
      phone: row.phone,
      city: row.city,
      province: row.province?.toUpperCase(),
      experienceYears: row.experience_years,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) rowErrors.push(`${String(issue.path[0])}: ${issue.message}`);
    }
    if (seen.has(email)) rowErrors.push("email: duplicated in this file");
    seen.add(email);

    const roles = splitList(row.roles).map((r) => r.toUpperCase());
    const badRoles = roles.filter((r) => !FIELD_ROLES.includes(r as FieldRole));
    if (badRoles.length) rowErrors.push(`roles: unknown ${badRoles.join(", ")} (use BA, TL, PA, AM)`);

    const rates: Partial<Record<FieldRole, number>> = {};
    if (opts.canEditRates) {
      for (const [col, role] of Object.entries(RATE_COLUMNS)) {
        if (!row[col]) continue;
        const cents = parseDollarsToCents(row[col]!);
        if (cents === null) continue;
        if (Number.isNaN(cents)) rowErrors.push(`${col}: "${row[col]}" isn't a valid hourly rate`);
        else rates[role] = cents;
      }
    }

    if (rowErrors.length || !parsed.success) return { line, email, action: "error", errors: rowErrors };
    return {
      line,
      email,
      action: existing.has(email) ? "update" : "create",
      errors: [],
      data: {
        profile: parsed.data,
        roles: roles as FieldRole[],
        languages: splitList(row.languages),
        skills: splitList(row.skills),
        rates,
      },
    };
  });

  return {
    results,
    counts: {
      create: results.filter((r) => r.action === "create").length,
      update: results.filter((r) => r.action === "update").length,
      error: results.filter((r) => r.action === "error").length,
    },
    ignoredRateColumns: !opts.canEditRates && headers.some((h) => h in RATE_COLUMNS),
  };
}

async function lookupIds(tx: Tx, table: typeof skills | typeof languages, names: string[]) {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (!unique.length) return new Map<string, string>();
  const find = () => tx.select().from(table).where(inArray(sql`lower(${table.name})`, unique.map((n) => n.toLowerCase())));
  // Match existing names case-insensitively so "sampling" reuses "Sampling".
  const known = new Set((await find()).map((r) => r.name.toLowerCase()));
  const missing = [...new Map(unique.filter((n) => !known.has(n.toLowerCase())).map((n) => [n.toLowerCase(), n])).values()];
  if (missing.length) await tx.insert(table).values(missing.map((name) => ({ name }))).onConflictDoNothing();
  return new Map((await find()).map((r) => [r.name.toLowerCase(), r.id]));
}

/**
 * Applies a validated import. Rows with errors are skipped. Existing profiles (matched by email)
 * are updated only for fields present in the file; roles, languages and skills are added, never removed.
 */
export async function commitImport(actorId: string, csvText: string, opts: { canEditRates: boolean }) {
  const preview = await previewImport(csvText, opts);
  const valid = preview.results.filter((r) => r.action !== "error" && r.data);
  await db.transaction(async (tx) => {
    const skillIds = await lookupIds(tx, skills, valid.flatMap((r) => r.data!.skills));
    const languageIds = await lookupIds(tx, languages, valid.flatMap((r) => r.data!.languages));
    for (const r of valid) {
      const { profile, roles, rates } = r.data!;
      const provided = Object.fromEntries(Object.entries(profile).filter(([, v]) => v !== null && v !== undefined));
      let staffId: string;
      const [match] = await tx
        .select({ id: staffProfiles.id })
        .from(staffProfiles)
        .where(eq(sql`lower(${staffProfiles.email})`, profile.email));
      if (match) {
        staffId = match.id;
        const updates = { ...provided };
        delete updates.email;
        if (Object.keys(updates).length) await tx.update(staffProfiles).set(updates).where(eq(staffProfiles.id, staffId));
      } else {
        const [created] = await tx.insert(staffProfiles).values(profile).returning({ id: staffProfiles.id });
        staffId = created!.id;
        await tx.insert(staffSensitive).values({ staffId });
      }
      if (roles.length) await tx.insert(staffRoles).values(roles.map((role) => ({ staffId, role }))).onConflictDoNothing();
      const sk = r.data!.skills.map((n) => skillIds.get(n.toLowerCase())).filter((x): x is string => Boolean(x));
      if (sk.length) await tx.insert(staffSkills).values(sk.map((skillId) => ({ staffId, skillId }))).onConflictDoNothing();
      const lg = r.data!.languages.map((n) => languageIds.get(n.toLowerCase())).filter((x): x is string => Boolean(x));
      if (lg.length) await tx.insert(staffLanguages).values(lg.map((languageId) => ({ staffId, languageId }))).onConflictDoNothing();
      for (const [role, cents] of Object.entries(rates) as [FieldRole, number][]) {
        await setStaffRate(actorId, staffId, role, cents, "CSV import", tx);
      }
    }
    await recordAudit(
      { actorId, action: "staff.import", entityType: "staff_profile", after: { ...preview.counts, rows: preview.results.length } },
      tx,
    );
  });
  return preview.counts;
}

export async function getTalentLookups() {
  const [s, l, c, lists, cities] = await Promise.all([
    db.select().from(skills).orderBy(skills.name),
    db.select().from(languages).orderBy(languages.name),
    db.select().from(certifications).orderBy(certifications.name),
    db
      .select({
        id: staffLists.id,
        name: staffLists.name,
        description: staffLists.description,
        members: sql<number>`(select count(*)::int from ${staffListMembers} m where m.list_id = ${staffLists.id})`,
      })
      .from(staffLists)
      .orderBy(staffLists.name),
    db
      .selectDistinct({ city: staffProfiles.city })
      .from(staffProfiles)
      .where(sql`${staffProfiles.city} is not null`)
      .orderBy(staffProfiles.city),
  ]);
  return { skills: s, languages: l, certifications: c, lists, cities: cities.map((x) => x.city!).filter(Boolean) };
}
