import { eq } from "drizzle-orm";
import type { ProfileDefaults } from "@/components/portal/profile-form";
import { db } from "@/server/db";
import { staffProfiles, staffRoles } from "@/server/db/schema";

export async function getProfileDefaults(staffId: string | undefined, fallbackName: string): Promise<ProfileDefaults> {
  if (!staffId) {
    const [first = "", ...rest] = fallbackName.includes("@") ? [""] : fallbackName.split(" ");
    return { firstName: first, lastName: rest.join(" "), preferredName: "", phone: "", city: "", province: "ON", roles: [] };
  }
  const [p] = await db.select().from(staffProfiles).where(eq(staffProfiles.id, staffId));
  const roles = await db.select({ role: staffRoles.role }).from(staffRoles).where(eq(staffRoles.staffId, staffId));
  return {
    firstName: p?.firstName ?? "",
    lastName: p?.lastName ?? "",
    preferredName: p?.preferredName ?? "",
    phone: p?.phone ?? "",
    city: p?.city ?? "",
    province: p?.province ?? "ON",
    roles: roles.map((r) => r.role),
  };
}
