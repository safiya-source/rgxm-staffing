"use client";
import { CalendarIcon, HomeIcon, InboxIcon, MessageSquareIcon, UserIcon, WalletIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/portal", label: "Home", icon: HomeIcon },
  { href: "/portal/opportunities", label: "Jobs", icon: InboxIcon },
  { href: "/portal/schedule", label: "Schedule", icon: CalendarIcon },
  { href: "/portal/messages", label: "Messages", icon: MessageSquareIcon },
  { href: "/portal/payments", label: "Pay", icon: WalletIcon },
  { href: "/portal/profile", label: "Profile", icon: UserIcon },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-6">
        {ITEMS.map((item) => {
          const active = item.href === "/portal" ? pathname === "/portal" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-muted-foreground",
                  active && "text-foreground",
                )}
              >
                <Icon className={cn("size-5", active && "text-brand")} strokeWidth={active ? 2.25 : 1.75} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
