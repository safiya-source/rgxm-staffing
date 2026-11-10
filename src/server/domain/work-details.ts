// A contractor's own work details: driver's licence, vehicle, travel, experience, languages and skills.
// Filled in after profile setup (and editable later from My profile). All answers are optional.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "@/server/audit";
import { db } from "@/server/db";
import { languages, skills, staffLanguages, staffProfiles, staffSkills } from "@/server/db/schema";
import { lookupIds } from "@/server/domain/talent";

const blankToNull = (v: unknown) => (v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : v);
const yesNo = z.preprocess((v) => (v === "yes" ? true : v === "no" ? false : null), z.boolean().nullable());
const tagList = z.preprocess(
  (v) =>
    typeof v === "string"
      ? [...new Map(v.split(/[,;|\n]/).map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean).map((s) => [s.toLowerCase(), s])).values()]
      : [],
  z.array(z.string().max(40, "Keep each one under 40 characters.")).max(15, "List up to 15."),
);

export const workDetailsSchema = z
  .object({
    hasDriversLicence: yesNo,
    hasVehicle: yesNo,
    willingToTravel: yesNo,
    travelRadiusKm: z.preprocess(blankToNull, z.coerce.number().int("Whole kilometres only.").min(1, "Enter at least 1 km.").max(5000).nullable()),
    experienceYears: z.preprocess(blankToNull, z.coerce.number().int("Whole years only.").min(0).max(60).nullable()),
    languages: tagList,
    skills: tagList,
  })
  // A distance only makes sense when they're willing to travel.
  .transform((d) => ({ ...d, travelRadiusKm: d.willingToTravel ? d.travelRadiusKm : null }));
export type WorkDetailsInput = Partial<Record<keyof z.input<typeof workDetailsSchema>, unknown>>;

export type WorkDetails = {
  hasDriversLicence: boolean | null;
  hasVehicle: boolean | null;
  willingToTravel: boolean | null;
  travelRadiusKm: number | null;
  experienceYears: number | null;
  languages: string[];
  skills: string[];
};

export async function getWorkDetails(staffId: string): Promise<WorkDetails> {
  const [[p], langs, sks] = await Promise.all([
    db
      .select({
        hasDriversLicence: staffProfiles.hasDriversLicence,
        hasVehicle: staffProfiles.hasVehicle,
        willingToTravel: staffProfiles.willingToTravel,
        travelRadiusKm: staffProfiles.travelRadiusKm,
        experienceYears: staffProfiles.experienceYears,
      })
      .from(staffProfiles)
      .where(eq(staffProfiles.id, staffId)),
    db.select({ name: languages.name }).from(staffLanguages).innerJoin(languages, eq(languages.id, staffLanguages.languageId)).where(eq(staffLanguages.staffId, staffId)),
    db.select({ name: skills.name }).from(staffSkills).innerJoin(skills, eq(skills.id, staffSkills.skillId)).where(eq(staffSkills.staffId, staffId)),
  ]);
  return {
    hasDriversLicence: p?.hasDriversLicence ?? null,
    hasVehicle: p?.hasVehicle ?? null,
    willingToTravel: p?.willingToTravel ?? null,
    travelRadiusKm: p?.travelRadiusKm ?? null,
    experienceYears: p?.experienceYears ?? null,
    languages: langs.map((l) => l.name).sort(),
    skills: sks.map((s) => s.name).sort(),
  };
}

/** Saves the contractor's answers. Languages and skills are replaced with the list they submit. */
export async function saveWorkDetails(actorUserId: string, staffId: string, raw: WorkDetailsInput) {
  const input = workDetailsSchema.parse(raw);
  const { languages: langNames, skills: skillNames, ...fields } = input;
  await db.transaction(async (tx) => {
    await tx.update(staffProfiles).set(fields).where(eq(staffProfiles.id, staffId));
    const [langIds, skillIds] = [await lookupIds(tx, languages, langNames), await lookupIds(tx, skills, skillNames)];
    await tx.delete(staffLanguages).where(eq(staffLanguages.staffId, staffId));
    await tx.delete(staffSkills).where(eq(staffSkills.staffId, staffId));
    const lg = [...new Set(langNames.map((n) => langIds.get(n.toLowerCase())).filter((x): x is string => Boolean(x)))];
    const sk = [...new Set(skillNames.map((n) => skillIds.get(n.toLowerCase())).filter((x): x is string => Boolean(x)))];
    if (lg.length) await tx.insert(staffLanguages).values(lg.map((languageId) => ({ staffId, languageId })));
    if (sk.length) await tx.insert(staffSkills).values(sk.map((skillId) => ({ staffId, skillId })));
    await recordAudit({ actorId: actorUserId, action: "staff.work_details_update", entityType: "staff_profile", entityId: staffId, after: input }, tx);
  });
  return input;
}
