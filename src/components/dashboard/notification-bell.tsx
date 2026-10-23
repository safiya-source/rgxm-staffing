"use client";
import { formatDistanceToNow } from "date-fns";
import { BellIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { markAllNotificationsRead } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type BellItem = { id: string; title: string; body: string | null; href: string | null; createdAt: string; read: boolean };

export function NotificationBell({ items, unread }: { items: BellItem[]; unread: number }) {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative">
          <BellIcon />
          {unread > 0 ? (
            <span className="absolute top-1.5 right-1.5 flex min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] leading-4 font-semibold text-brand-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 ? (
            <button
              className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
              onClick={async () => {
                await markAllNotificationsRead();
                router.refresh();
              }}
            >
              Mark all read
            </button>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {items.map((n) => {
              const inner = (
                <>
                  <p className={cn("text-sm", !n.read && "font-medium")}>{n.title}</p>
                  {n.body ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p> : null}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                  </p>
                </>
              );
              return (
                <li key={n.id} className="border-b last:border-0">
                  {n.href ? (
                    <Link href={n.href} className="block px-3 py-2.5 hover:bg-accent">
                      {inner}
                    </Link>
                  ) : (
                    <div className="px-3 py-2.5">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
