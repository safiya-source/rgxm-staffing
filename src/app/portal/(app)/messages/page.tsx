import { MegaphoneIcon, MessageSquareIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { listStaffAnnouncements, listStaffThreads } from "@/server/domain/comms";
import { requireStaff } from "@/server/session";
import { NewMessage } from "./new-message";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage() {
  const viewer = await requireStaff();
  const [threads, news] = await Promise.all([listStaffThreads(viewer.staff!.id), listStaffAnnouncements(viewer.staff!.id)]);
  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[22px] font-semibold">Messages</h1>
        <NewMessage />
      </div>

      <section aria-labelledby="conversations">
        <h2 id="conversations" className="mb-2 text-sm font-medium text-muted-foreground">
          Conversations with RGXM
        </h2>
        {threads.length === 0 ? (
          <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">No messages yet. Questions you ask about offers show up here.</p>
        ) : (
          <Card className="divide-y">
            {threads.map((t) => (
              <Link key={t.id} href={`/portal/messages/${t.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-accent">
                <MessageSquareIcon className="mt-0.5 size-5 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-[15px]", t.unread && "font-semibold")}>{t.projectName ?? "General"}</span>
                  <span className="block truncate text-sm text-muted-foreground">{t.preview}</span>
                </span>
                <span className="flex flex-col items-end gap-1 text-xs text-muted-foreground">
                  {t.lastMessageAt ? formatDistanceToNow(t.lastMessageAt, { addSuffix: true }) : null}
                  {t.unread ? <Badge tone="brand">New</Badge> : null}
                </span>
              </Link>
            ))}
          </Card>
        )}
      </section>

      <section aria-labelledby="announcements">
        <h2 id="announcements" className="mb-2 text-sm font-medium text-muted-foreground">
          Announcements
        </h2>
        {news.length === 0 ? (
          <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Updates from your project teams appear here once you&apos;re booked.</p>
        ) : (
          <Card className="divide-y">
            {news.map(({ a, projectName }) => (
              <div key={a.id} className="px-4 py-3">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  <MegaphoneIcon className="size-4 text-muted-foreground" /> {a.title} {a.important ? <Badge tone="danger">Important</Badge> : null}
                </p>
                <p className="mt-1 text-sm whitespace-pre-wrap">{a.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {projectName} · {formatDistanceToNow(a.createdAt, { addSuffix: true })}
                </p>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
