// CSV export of the talent directory (current filters, or explicit ids). Rates only for rates.view.
import { and, eq, inArray, isNull } from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { toCsv } from "@/lib/csv";
import { recordAudit } from "@/server/audit";
import { canAny } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { languages, skills, staffLanguages, staffProfiles, staffRates, staffRoles, staffSkills } from "@/server/db/schema";
import { parseTalentFilters, searchTalent } from "@/server/domain/talent-search";
import { RateLimitError, rateLimit } from "@/server/rate-limit";
import { getOrgSettings } from "@/server/settings";
import { authorizeInternal, ForbiddenError, toActor } from "@/server/session";

const MAX_EXPORT = 10_000;

export async function GET(request: Request) {
  let viewer;
  try {
    viewer = await authorizeInternal("talent.export");
    await rateLimit("export.talent", viewer.userId);
  } catch (err) {
    if (err instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    if (err instanceof RateLimitError) return new Response(err.message, { status: 429 });
    throw err;
  }
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const canSeeRates = canAny(toActor(viewer), "rates.view");

  let ids: string[];
  if (params.ids) {
    ids = z.array(z.string().uuid()).max(MAX_EXPORT).parse(params.ids.split(","));
  } else {
    const filters = { ...parseTalentFilters(params), page: 1 };
    const settings = await getOrgSettings();
    const result = await searchTalent(filters, { canSeeRates: false, timeZone: settings.defaultTimezone, limit: MAX_EXPORT });
    ids = result.rows.map((r) => r.id);
  }

  const profiles = ids.length ? await db.select().from(staffProfiles).where(inArray(staffProfiles.id, ids)).orderBy(staffProfiles.lastName) : [];
  const group = (rows: { staffId: string; value: string }[]) =>
    rows.reduce((m, r) => m.set(r.staffId, [...(m.get(r.staffId) ?? []), r.value]), new Map<string, string[]>());
  const [skillRows, langRows, roleRows] = ids.length
    ? await Promise.all([
        db.select({ staffId: staffSkills.staffId, value: skills.name }).from(staffSkills).innerJoin(skills, eq(skills.id, staffSkills.skillId)).where(inArray(staffSkills.staffId, ids)),
        db
          .select({ staffId: staffLanguages.staffId, value: languages.name })
          .from(staffLanguages)
          .innerJoin(languages, eq(languages.id, staffLanguages.languageId))
          .where(inArray(staffLanguages.staffId, ids)),
        db.select({ staffId: staffRoles.staffId, value: staffRoles.role }).from(staffRoles).where(inArray(staffRoles.staffId, ids)).orderBy(staffRoles.role),
      ])
    : [[], [], []];
  const skillMap = group(skillRows);
  const langMap = group(langRows);
  const roleMap = group(roleRows);
  const rateMap = new Map<string, Record<string, number>>();
  if (canSeeRates && ids.length) {
    const rates = await db
      .select({ staffId: staffRates.staffId, role: staffRates.role, rateCents: staffRates.rateCents })
      .from(staffRates)
      .where(and(inArray(staffRates.staffId, ids), isNull(staffRates.effectiveTo)));
    for (const r of rates) rateMap.set(r.staffId, { ...rateMap.get(r.staffId), [r.role]: r.rateCents });
  }

  const headers = ["first_name", "last_name", "preferred_name", "email", "phone", "city", "province", "status", "roles", "languages", "skills", "experience_years"];
  if (canSeeRates) headers.push("ba_rate", "tl_rate", "pa_rate", "am_rate");
  const dollars = (c: number | undefined) => (c === undefined ? "" : (c / 100).toFixed(2));
  const rows = profiles.map((p) => {
    const base: unknown[] = [
      p.firstName,
      p.lastName,
      p.preferredName,
      p.email,
      p.phone,
      p.city,
      p.province,
      p.status,
      (roleMap.get(p.id) ?? []).join("|"),
      (langMap.get(p.id) ?? []).join("|"),
      (skillMap.get(p.id) ?? []).join("|"),
      p.experienceYears,
    ];
    if (canSeeRates) {
      const r = rateMap.get(p.id) ?? {};
      base.push(dollars(r.BA), dollars(r.TL), dollars(r.PA), dollars(r.AM));
    }
    return base;
  });

  await recordAudit({ actorId: viewer.userId, action: "staff.export", entityType: "staff_profile", after: { rows: rows.length, includesRates: canSeeRates } });

  return new Response("﻿" + toCsv(headers, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="rgxm-talent-${format(new Date(), "yyyy-MM-dd")}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
