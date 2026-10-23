import { eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/server/db";
import { orgSettings } from "@/server/db/schema";

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const getOrgSettings = cache(async () => {
  const [row] = await db.select().from(orgSettings).where(eq(orgSettings.id, 1));
  return (
    row ?? {
      id: 1,
      orgName: "RGXM",
      accentColor: "#E4572E",
      defaultTimezone: "America/Toronto",
      defaultCurrency: "CAD",
      checkInWindowMinutes: 60,
      checkInGeofenceMeters: 300,
      payPeriodRule: "semi_monthly",
      payableRounding: "minute",
      updatedAt: new Date(),
      updatedBy: null,
    }
  );
});

/** Picks black or white text for legibility on the accent colour (WCAG relative luminance). */
export function readableForeground(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return luminance > 0.4 ? "#18181b" : "#ffffff";
}
