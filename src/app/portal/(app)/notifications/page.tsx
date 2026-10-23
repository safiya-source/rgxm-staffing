import { BellIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { EmptyState } from "@/components/app/empty-state";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getNotificationSummary } from "@/server/queries/notifications";
import { requireStaff } from "@/server/session";
import { MarkAllRead } from "./mark-all-read";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const viewer = await requireStaff();
  const { items, unread } = await getNotificationSummary(viewer.userId, 50);
  return (
    <div className="grid gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-[22px] font-semibold">Notifications</h1>
        {unread ? <MarkAllRead /> : null}
      </div>
      {items.length === 0 ? (
        <EmptyState icon={BellIcon} title="You're all caught up" />
      ) : (
        <Card className="divide-y">
          {items.map((n) => {
            const inner = (
              <>
                <p className={cn("text-[15px]", !n.read && "font-semibold")}>{n.title}</p>
                {n.body ? <p className="text-sm text-muted-foreground">{n.body}</p> : null}
                <p className="mt-1 text-xs text-muted-foreground">{formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}</p>
              </>
            );
            return n.href ? (
              <Link key={n.id} href={n.href} className="block px-4 py-3 hover:bg-accent">
                {inner}
              </Link>
            ) : (
              <div key={n.id} className="px-4 py-3">
                {inner}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
