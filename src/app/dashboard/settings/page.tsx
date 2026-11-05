import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canAny } from "@/server/authz/permissions";
import { getOrgSettings } from "@/server/settings";
import { requireInternal, toActor } from "@/server/session";
import { DefaultRatesForm } from "./default-rates-form";
import { OrgSettingsForm } from "./org-settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function OrgSettingsPage() {
  const viewer = await requireInternal();
  const actor = toActor(viewer);
  if (!canAny(actor, "settings.view")) redirect("/dashboard/settings/security");
  const settings = await getOrgSettings();
  return (
    <div className="grid gap-6">
      {canAny(actor, "rates.view") ? <DefaultRatesForm initial={settings.defaultRates} canEdit={canAny(actor, "rates.edit")} /> : null}
      <OrgSettingsForm
      canEdit={canAny(actor, "settings.manage")}
      initial={{
        orgName: settings.orgName,
        accentColor: settings.accentColor,
        checkInWindowMinutes: settings.checkInWindowMinutes,
        checkInGeofenceMeters: settings.checkInGeofenceMeters,
        requireMfaForPrivileged: settings.requireMfaForPrivileged,
        locationRetentionDays: settings.locationRetentionDays,
        mailLogRetentionDays: settings.mailLogRetentionDays,
      }}
      />
    </div>
  );
}
