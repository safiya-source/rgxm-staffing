import { PageHeader } from "@/components/app/page-header";
import { canAny, type Permission } from "@/server/authz/permissions";
import { requireInternal, toActor } from "@/server/session";
import { SettingsNav } from "./settings-nav";

const ITEMS: { href: string; label: string; permission?: Permission }[] = [
  { href: "/dashboard/settings", label: "Organisation", permission: "settings.view" },
  { href: "/dashboard/settings/users", label: "Team & roles", permission: "users.manage" },
  { href: "/dashboard/settings/security", label: "My security" },
  { href: "/dashboard/settings/audit", label: "Audit log", permission: "audit.view" },
  { href: "/dashboard/settings/mail-log", label: "Mail log", permission: "mail_log.view" },
];

export default async function SettingsLayout({ children }: LayoutProps<"/dashboard/settings">) {
  const viewer = await requireInternal();
  const actor = toActor(viewer);
  const items = ITEMS.filter((i) => !i.permission || canAny(actor, i.permission));
  return (
    <>
      <PageHeader title="Settings" />
      <SettingsNav items={items} />
      {children}
    </>
  );
}
