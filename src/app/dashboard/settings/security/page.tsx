import type { Metadata } from "next";
import { needsMfaSetup, PRIVILEGED_ROLES, requireInternal } from "@/server/session";
import { getOrgSettings } from "@/server/settings";
import { TwoFactorSettings } from "./two-factor-settings";

export const metadata: Metadata = { title: "My security" };

export default async function SecurityPage() {
  const viewer = await requireInternal(undefined, { allowWithoutMfa: true });
  const [mustSetUp, settings] = await Promise.all([needsMfaSetup(viewer), getOrgSettings()]);
  // Every RGXM staff account must use two-step verification (Admin and Finance always).
  const required = settings.requireMfaForStaff || (settings.requireMfaForPrivileged && viewer.roles.some((r) => PRIVILEGED_ROLES.includes(r)));
  return (
    <div className="grid gap-4">
      {mustSetUp ? (
        <p role="alert" className="max-w-2xl rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning">
          All RGXM staff accounts must use two-step verification. Set it up below to continue.
        </p>
      ) : null}
      <TwoFactorSettings enabled={viewer.twoFactorEnabled} required={required} />
      <p className="max-w-2xl text-sm text-muted-foreground">
        You can trust a device for 14 days when you enter a code at sign-in. New devices, expired sessions and sign-ins from an unfamiliar network or browser
        always ask for a code, and approving payments or changing payment details asks for a fresh code.
      </p>
    </div>
  );
}
