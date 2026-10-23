"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { DASHBOARD_NAV } from "./nav";

export function SidebarNav({ allowed, onNavigate }: { allowed: string[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="grid gap-0.5">
      {DASHBOARD_NAV.filter((item) => allowed.includes(item.href)).map((item) => {
        const active = item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              active && "bg-card text-foreground shadow-xs ring-1 ring-border",
            )}
          >
            <Icon className={cn("size-4", active && "text-brand")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
