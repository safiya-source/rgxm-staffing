import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { db } from "@/server/db";
import * as talent from "@/server/domain/talent";
import { getWorkDetails, saveWorkDetails } from "@/server/domain/work-details";
import { makeUser, pool } from "./fixtures";

const tag = `w${Date.now()}`;
let actor: { id: string };

beforeAll(async () => {
  actor = await makeUser();
});
afterAll(async () => {
  await pool.end();
  await db.$client.end();
});

const newStaff = (n: string) => talent.createStaff(actor.id, { firstName: n, lastName: tag, email: `${n.toLowerCase()}.${tag}@example.test` }, ["CH"]);

describe("contractor work details", () => {
  it("saves licence, vehicle, travel, experience, languages and skills", async () => {
    const id = await newStaff("Ari");
    await saveWorkDetails(actor.id, id, {
      hasDriversLicence: "yes",
      hasVehicle: "no",
      willingToTravel: "yes",
      travelRadiusKm: "120",
      experienceYears: "5",
      languages: "English, french, English",
      skills: "Food handling certificate; Cooking demos",
    });
    const d = await getWorkDetails(id);
    expect(d).toMatchObject({ hasDriversLicence: true, hasVehicle: false, willingToTravel: true, travelRadiusKm: 120, experienceYears: 5 });
    expect(d.languages).toEqual(["English", "french"].map((n) => expect.stringMatching(new RegExp(`^${n}$`, "i"))));
    expect(d.skills).toHaveLength(2);
  });

  it("clears the distance when they won't travel, and replaces languages and skills", async () => {
    const id = await newStaff("Bea");
    await saveWorkDetails(actor.id, id, { willingToTravel: "yes", travelRadiusKm: "80", languages: "English, Spanish", skills: "Dance" });
    await saveWorkDetails(actor.id, id, { willingToTravel: "no", travelRadiusKm: "80", languages: "English", skills: "" });
    const d = await getWorkDetails(id);
    expect(d).toMatchObject({ willingToTravel: false, travelRadiusKm: null, skills: [] });
    expect(d.languages).toHaveLength(1);
  });

  it("leaves skipped questions unanswered and rejects bad numbers", async () => {
    const id = await newStaff("Cy");
    await saveWorkDetails(actor.id, id, {});
    expect(await getWorkDetails(id)).toMatchObject({ hasDriversLicence: null, hasVehicle: null, willingToTravel: null, experienceYears: null });
    await expect(saveWorkDetails(actor.id, id, { experienceYears: "-2" })).rejects.toBeInstanceOf(ZodError);
    await expect(saveWorkDetails(actor.id, id, { willingToTravel: "yes", travelRadiusKm: "0" })).rejects.toBeInstanceOf(ZodError);
  });
});
