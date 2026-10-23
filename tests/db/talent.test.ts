import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import * as talent from "@/server/domain/talent";
import { parseTalentFilters, searchTalent } from "@/server/domain/talent-search";
import { book, makeProject, makeShift, makeUser, one, pool } from "./fixtures";

const TZ = "America/Toronto";
let actor: { id: string };
const tag = `t${Date.now()}`; // isolates this file's people from other data
const email = (n: string) => `${n}.${tag}@example.test`;

async function staff(first: string, extra: Partial<talent.StaffProfileInput> = {}, roles: ("BA" | "TL" | "PA" | "AM")[] = ["BA"]) {
  return talent.createStaff(actor.id, { firstName: first, lastName: tag, email: email(first.toLowerCase()), city: "Toronto", province: "ON", ...extra }, roles);
}
const search = (params: Record<string, string>, canSeeRates = true) => searchTalent(parseTalentFilters({ q: tag, ...params }), { canSeeRates, timeZone: TZ });
const names = (r: Awaited<ReturnType<typeof search>>) => r.rows.map((x) => x.firstName).sort();

beforeAll(async () => {
  actor = await makeUser();
});
afterAll(async () => {
  await pool.end();
  await db.$client.end();
});

describe("talent profiles", () => {
  it("rejects a second profile with the same email (case-insensitive)", async () => {
    await staff("Dup");
    await expect(talent.createStaff(actor.id, { firstName: "Other", lastName: tag, email: email("DUP").toUpperCase() }, [])).rejects.toThrow(
      /already uses that email/,
    );
  });

  it("keeps rate history and only one current rate per role", async () => {
    const id = await staff("Rated");
    await talent.setStaffRate(actor.id, id, "BA", 2500, null);
    await talent.setStaffRate(actor.id, id, "BA", 2500, null); // no-op when unchanged
    await talent.setStaffRate(actor.id, id, "BA", 2750, "Review");
    const { rows } = await pool.query("select rate_cents, effective_to from staff_rates where staff_id = $1 order by effective_from", [id]);
    expect(rows.map((r) => r.rate_cents)).toEqual([2500, 2750]);
    expect(rows[0].effective_to).not.toBeNull();
    expect(rows[1].effective_to).toBeNull();
  });

  it("validates GST/HST numbers for registered contractors", async () => {
    const id = await staff("Contractor");
    const base = { classification: "contractor" as const, legalName: null, businessName: null };
    await expect(talent.setClassification(actor.id, id, { ...base, taxRegistered: true, gstHstNumber: null })).rejects.toThrow(/GST\/HST number/);
    await expect(talent.setClassification(actor.id, id, { ...base, taxRegistered: true, gstHstNumber: "12345" })).rejects.toThrow(/look like/);
    await talent.setClassification(actor.id, id, { ...base, taxRegistered: true, gstHstNumber: "123456789 RT0001" });
    expect((await one("select classification from staff_profiles where id = $1", [id])).classification).toBe("contractor");
  });
});

describe("talent search", () => {
  let ids: Record<string, string>;
  beforeAll(async () => {
    ids = {
      ana: await staff("Ana", { city: "Toronto" }, ["BA"]),
      ben: await staff("Ben", { city: "Mississauga", hasVehicle: true, experienceYears: 5 }, ["BA", "TL"]),
      cy: await staff("Cy", { city: "Toronto" }, ["PA"]),
      dee: await staff("Dee", { city: "Toronto" }, ["BA"]),
    };
    await talent.setStaffRate(actor.id, ids.ana!, "BA", 2500, null);
    await talent.setStaffRate(actor.id, ids.ben!, "BA", 3000, null);
    await talent.setStaffStatus(actor.id, ids.dee!, "suspended", "Test");
  });

  it("filters by role, city and status", async () => {
    const bas = names(await search({ role: "BA" }));
    expect(bas).toEqual(expect.arrayContaining(["Ana", "Ben"]));
    expect(bas).not.toContain("Cy"); // PA only
    expect(names(await search({ role: "TL" }))).toEqual(["Ben"]);
    expect(names(await search({ city: "mississauga" }))).toEqual(["Ben"]);
    expect(names(await search({ status: "suspended" }))).toEqual(["Dee"]);
    expect(names(await search({ role: "BA" }))).not.toContain("Dee"); // suspended hidden by default
    expect(names(await search({ vehicle: "1" }))).toEqual(["Ben"]);
    expect(names(await search({ minExperience: "3" }))).toEqual(["Ben"]);
  });

  it("applies rate filters only for people allowed to see rates", async () => {
    expect(names(await search({ role: "BA", maxRate: "2600" }))).toEqual(["Ana"]);
    expect(names(await search({ role: "BA", maxRate: "2600" }, false))).toContain("Ben");
  });

  it("filters by declared availability and booking conflicts", async () => {
    // 2026-11-14 is a Saturday.
    await pool.query("insert into availability_rules (staff_id, weekday, start_time, end_time) values ($1, 6, '08:00', '22:00'), ($2, 6, '08:00', '22:00')", [ids.ana, ids.ben]);
    await pool.query("insert into availability_exceptions (staff_id, date, kind) values ($1, '2026-11-14', 'unavailable')", [ids.ben]);
    expect(names(await search({ availableOn: "2026-11-14" }))).toEqual(["Ana"]);

    const p = await makeProject();
    const s = await makeShift(p, "2026-11-14T15:00:00Z", "2026-11-14T23:00:00Z");
    await book(s.id, ids.ana!);
    expect(names(await search({ availableOn: "2026-11-14" }))).toEqual(["Ana"]);
    expect(names(await search({ availableOn: "2026-11-14", noConflicts: "1" }))).toEqual([]);
  });

  it("filters by saved list and ignores expired certifications", async () => {
    const list = await talent.createList(actor.id, `List ${tag}`, null);
    await talent.addToList(actor.id, list, [ids.cy!, ids.cy!]);
    expect(names(await search({ list }))).toEqual(["Cy"]);

    const cert = await one<{ id: string }>("insert into certifications (name) values ($1) returning id", [`Cert ${tag}`]);
    await talent.addCertification(actor.id, ids.ana!, { certificationId: cert.id, issuedOn: null, expiresOn: "2020-01-01" });
    await talent.addCertification(actor.id, ids.cy!, { certificationId: cert.id, issuedOn: null, expiresOn: "2030-01-01" });
    expect(names(await search({ certs: cert.id }))).toEqual(["Cy"]);
  });

  it("ignores malformed filter values instead of failing", () => {
    const f = parseTalentFilters({ role: "XX", page: "-3", availableOn: "nope", skills: "not-a-uuid", minRate: "abc" });
    expect(f).toMatchObject({ role: undefined, page: 1, availableOn: undefined, skills: [], minRate: undefined, status: "active" });
  });
});

describe("CSV import", () => {
  const header = "first_name,last_name,email,phone,city,roles,languages,skills,ba_rate";

  it("previews without writing and reports row errors", async () => {
    const csv = [
      header,
      `Imp,One,${email("imp1")},416-555-0101,Toronto,BA|TL,English|French,Sampling,26.50`,
      `Imp,Two,not-an-email,,Toronto,BA,,,`,
      `Imp,Three,${email("imp3")},,Toronto,XX,,,`,
      `Imp,Dup,${email("imp1")},,Toronto,BA,,,`,
    ].join("\n");
    const preview = await talent.previewImport(csv, { canEditRates: true });
    expect(preview.counts).toEqual({ create: 1, update: 0, error: 3 });
    expect(preview.results[1]!.errors.join()).toMatch(/email/);
    expect(preview.results[2]!.errors.join()).toMatch(/unknown XX/);
    expect(preview.results[3]!.errors.join()).toMatch(/duplicated/);
    expect((await one("select count(*)::int n from staff_profiles where email = $1", [email("imp1")])).n).toBe(0);
  });

  it("creates new people, updates existing ones without erasing data, and reuses skills case-insensitively", async () => {
    await pool.query("insert into skills (name) values ('Sampling') on conflict do nothing");
    const existing = await staff("Existing", { phone: "416-555-0199", city: "Toronto" });
    const csv = [
      header,
      `New,Person,${email("newperson")},,Toronto,BA,English,sampling,25`,
      `Existing,${tag},${email("existing")},,Hamilton,TL,,,`,
    ].join("\n");
    const counts = await talent.commitImport(actor.id, csv, { canEditRates: true });
    expect(counts).toMatchObject({ create: 1, update: 1 });

    const updated = await one("select city, phone from staff_profiles where id = $1", [existing]);
    expect(updated).toEqual({ city: "Hamilton", phone: "416-555-0199" }); // blank phone didn't erase
    const roles = await pool.query("select role::text from staff_roles where staff_id = $1 order by role", [existing]);
    expect(roles.rows.map((r) => r.role)).toEqual(["BA", "TL"]); // added, not replaced

    const skillCount = await one("select count(*)::int n from skills where lower(name) = 'sampling'");
    expect(skillCount.n).toBe(1);
    const rate = await one("select r.rate_cents from staff_rates r join staff_profiles p on p.id = r.staff_id where p.email = $1", [email("newperson")]);
    expect(rate.rate_cents).toBe(2500);
  });

  it("ignores rate columns for importers who can't edit rates", async () => {
    const csv = [header, `NoRate,Person,${email("norate")},,Toronto,BA,,,40`].join("\n");
    const preview = await talent.previewImport(csv, { canEditRates: false });
    expect(preview.ignoredRateColumns).toBe(true);
    await talent.commitImport(actor.id, csv, { canEditRates: false });
    const n = await one("select count(*)::int n from staff_rates r join staff_profiles p on p.id = r.staff_id where p.email = $1", [email("norate")]);
    expect(n.n).toBe(0);
  });

  it("parses dollar amounts into cents exactly", () => {
    expect(talent.parseDollarsToCents("25")).toBe(2500);
    expect(talent.parseDollarsToCents("$27.5")).toBe(2750);
    expect(talent.parseDollarsToCents("0.07")).toBe(7);
    expect(talent.parseDollarsToCents("")).toBeNull();
    expect(talent.parseDollarsToCents("25.555")).toBeNaN();
    expect(talent.parseDollarsToCents("-5")).toBeNaN();
  });
});
