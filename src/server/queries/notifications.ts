import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { notifications } from "@/server/db/schema";

export async function getNotificationSummary(userId: string, limit = 8) {
  const [items, [unread]] = await Promise.all([
    db
      .select({
        id: notifications.id,
        title: notifications.title,
        body: notifications.body,
        href: notifications.href,
        createdAt: notifications.createdAt,
        readAt: notifications.readAt,
      })
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit),
    db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);
  return {
    unread: unread?.n ?? 0,
    items: items.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      href: n.href,
      createdAt: n.createdAt.toISOString(),
      read: Boolean(n.readAt),
    })),
  };
}
