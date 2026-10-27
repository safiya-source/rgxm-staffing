import { BellIcon } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/app/logo";
import { BottomNav } from "@/components/portal/bottom-nav";
import { RegisterServiceWorker } from "@/components/portal/register-sw";
import { getNotificationSummary } from "@/server/queries/notifications";
import { requireStaff } from "@/server/session";

export default async function PortalLayout({ children }: LayoutProps<"/portal">) {
  const viewer = await requireStaff();
  const { unread } = await getNotificationSummary(viewer.userId, 1);
  return (
    <div className="min-h-dvh pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-30 border-b bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-13 max-w-lg items-center justify-between px-4">
          <Link href="/portal" aria-label="Home">
            <Logo />
          </Link>
          <Link
            href="/portal/notifications"
            aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
            className="relative rounded-full p-2 hover:bg-accent"
          >
            <BellIcon className="size-5" />
            {unread ? (
              <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] leading-4 font-semibold text-brand-foreground">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 pt-5">{children}</main>
      <BottomNav />
      <RegisterServiceWorker />
    </div>
  );
}
