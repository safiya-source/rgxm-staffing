import type { Metadata } from "next";
import { needsMfaSetup, PRIVILEGED_ROLES, requireInternal } from "@/server/session";
import { getOrgSettings } from "@/server/settings";
import { TwoFactorSettings } from "./two-factor-settings";

export const metadata: Metadata = { title: "My security" };

export default async function SecurityPage() {
  const viewer = await requireInternal(undefined, { allowWithoutMfa: true });
  const [mustSetUp, settings] = await Promise.all([needsMfaSetup(viewer), getOrgSettings()]);
  const required = settings.requireMfaForPrivileged && viewer.roles.some((r) => PRIVILEGED_ROLES.includes(r));
  return (
    <div className="grid gap-4">
      {mustSetUp ? (
        <p role="alert" className="max-w-2xl rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning">
          Your role can approve payments or manage access, so two-step verification is required. Set it up below to continue.
        </p>
      ) : null}
      <TwoFactorSettings enabled={viewer.twoFactorEnabled} required={required} />
    </div>
  );
}
