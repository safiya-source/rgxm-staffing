import { PageHeader } from "@/components/app/page-header";
import { canAny, type Permission } from "@/server/authz/permissions";
import { requireInternal, toActor } from "@/server/session";
import { getOrgSettings } from "@/server/settings";
import { SettingsNav } from "./settings-nav";

const ITEMS: { href: string; label: string; permission?: Permission }[] = [
  { href: "/dashboard/settings", label: "Organisation", permission: "settings.view" },
  { href: "/dashboard/settings/users", label: "Team & roles", permission: "users.manage" },
  { href: "/dashboard/settings/security", label: "My security" },
  { href: "/dashboard/settings/audit", label: "Audit log", permission: "audit.view" },
  { href: "/dashboard/settings/mail-log", label: "Mail log", permission: "mail_log.view" },
];

export default async function SettingsLayout({ children }: LayoutProps<"/dashboard/settings">) {
  const viewer = await requireInternal(undefined, { allowWithoutMfa: true });
  const actor = toActor(viewer);
  const items = ITEMS.filter((i) => !i.permission || canAny(actor, i.permission));
  const settings = await getOrgSettings();
  return (
    <>
      <PageHeader title="Settings" />
      {!settings.requireMfaForPrivileged ? (
        <p role="status" className="mb-4 rounded-lg border border-warning/40 bg-warning-soft px-4 py-2.5 text-sm text-warning">
          Two-step verification isn&apos;t required for Administrators and Finance. Turn it on in Organisation settings before using real data.
        </p>
      ) : null}
      <SettingsNav items={items} />
      {children}
    </>
  );
}
