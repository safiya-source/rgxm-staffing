import Link from "next/link";
import { Logo } from "@/components/app/logo";
import { BottomNav } from "@/components/portal/bottom-nav";
import { RegisterServiceWorker } from "@/components/portal/register-sw";
import { requireStaff } from "@/server/session";

export default async function PortalLayout({ children }: LayoutProps<"/portal">) {
  await requireStaff();
  return (
    <div className="min-h-dvh pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-30 border-b bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-13 max-w-lg items-center px-4">
          <Link href="/portal" aria-label="Home">
            <Logo />
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 pt-5">{children}</main>
      <BottomNav />
      <RegisterServiceWorker />
    </div>
  );
}
