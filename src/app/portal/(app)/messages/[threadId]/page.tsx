import { and, eq } from "drizzle-orm";
import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { db } from "@/server/db";
import { messageThreads, projects } from "@/server/db/schema";
import { getThreadMessages, markThreadRead } from "@/server/domain/comms";
import { requireStaff } from "@/server/session";
import { ReplyBox } from "./reply-box";

export const metadata: Metadata = { title: "Conversation" };

export default async function ThreadPage({ params }: PageProps<"/portal/messages/[threadId]">) {
  const viewer = await requireStaff();
  const { threadId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(threadId)) notFound();
  const [thread] = await db
    .select({ id: messageThreads.id, projectName: projects.name })
    .from(messageThreads)
    .leftJoin(projects, eq(projects.id, messageThreads.projectId))
    .where(and(eq(messageThreads.id, threadId), eq(messageThreads.staffId, viewer.staff!.id)));
  if (!thread) notFound();
  const messages = await getThreadMessages(threadId);
  await markThreadRead(threadId, "staff");

  return (
    <div className="grid gap-4">
      <Link href="/portal/messages" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <ArrowLeftIcon className="size-4" /> Messages
      </Link>
      <h1 className="text-[22px] font-semibold">{thread.projectName ?? "General"}</h1>
      <ol className="grid gap-2">
        {messages.map((m) => {
          const mine = m.authorKind === "staff";
          return (
            <li key={m.id} className={cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px]", mine ? "ml-auto bg-foreground text-background" : "bg-card ring-1 ring-border")}>
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p className={cn("mt-1 text-[11px]", mine ? "text-background/70" : "text-muted-foreground")}>
                {mine ? "You" : `${m.authorName} · RGXM`} · {formatDistanceToNow(m.createdAt, { addSuffix: true })}
              </p>
            </li>
          );
        })}
      </ol>
      <ReplyBox threadId={thread.id} />
    </div>
  );
}
