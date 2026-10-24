import Link from "next/link";
import { Logo } from "@/components/app/logo";
import { DASHBOARD_NAV } from "@/components/dashboard/nav";
import { GlobalSearch } from "@/components/dashboard/global-search";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { NotificationBell } from "@/components/dashboard/notification-bell";
import { SidebarNav } from "@/components/dashboard/sidebar-nav";
import { UserMenu } from "@/components/dashboard/user-menu";
import { canAny, ROLE_LABELS } from "@/server/authz/permissions";
import { getNotificationSummary } from "@/server/queries/notifications";
import { requireInternal, toActor } from "@/server/session";

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const viewer = await requireInternal(undefined, { allowWithoutMfa: true });
  const actor = toActor(viewer);
  const allowed = DASHBOARD_NAV.filter((i) => !i.permission || canAny(actor, i.permission)).map((i) => i.href);
  const notifications = await getNotificationSummary(viewer.userId);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-sidebar-border bg-sidebar px-3 py-5 lg:flex">
        <Link href="/dashboard" className="mb-7 px-2.5">
          <Logo suffix="Staffing" />
        </Link>
        <SidebarNav allowed={allowed} />
        <div className="mt-auto px-2.5 text-xs text-muted-foreground">
          {viewer.roles.length === 0 ? "No role assigned. Ask an administrator." : null}
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur sm:px-6">
          <MobileNav allowed={allowed} />
          <div className="flex-1">
            <GlobalSearch />
          </div>
          <NotificationBell items={notifications.items} unread={notifications.unread} />
          <UserMenu name={viewer.name} email={viewer.email} roleLabels={viewer.roles.map((r) => ROLE_LABELS[r])} />
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
